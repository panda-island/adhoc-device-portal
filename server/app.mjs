import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApple } from './apple.mjs';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const hash = s => createHash('sha256').update(s).digest('hex');
export const validUdid = s => typeof s === 'string' && /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{8}-[a-fA-F0-9]{16})$/.test(s);
const safeEqual = (a, b) => timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
export async function createApp({ env = process.env, apple = createApple(env), dataDir = path.resolve(env.DATA_DIR || './data') } = {}) {
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32 || env.ADMIN_TOKEN.startsWith('replace-')) throw Error('Set a random ADMIN_TOKEN (32+ characters) in .env');
  await mkdir(path.join(dataDir, 'profiles'), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'portal.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, tokenHash TEXT NOT NULL, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at TEXT, orderId TEXT, action TEXT);
  `);
  const get = id => { const r = db.prepare('SELECT * FROM orders WHERE id=?').get(id); return r && { ...JSON.parse(r.json), tokenHash: r.tokenHash }; };
  const save = o => { const { tokenHash, ...data } = o; db.prepare('UPDATE orders SET json=? WHERE id=?').run(JSON.stringify(data), o.id); };
  const audit = (id, action) => db.prepare('INSERT INTO audit(at,orderId,action) VALUES(?,?,?)').run(new Date().toISOString(), id, action);
  const view = o => { const { tokenHash, udid, ...data } = o; return { ...data, udid: `${udid.slice(0, 8)}…${udid.slice(-4)}`, appleMode: apple.mode }; };
  const rates = new Map();
  const busy = new Set();
  async function locked(id, fn) {
    if (busy.has(id)) throw Object.assign(Error('此申請正在處理，請稍後重試'), { status: 409 });
    busy.add(id); try { return await fn(); } finally { busy.delete(id); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const origin = req.headers.origin;
    const allowed = env.ALLOWED_ORIGIN || 'http://localhost:3000';
    function json(code, value) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
    try {
      if (origin && origin !== allowed) return json(403, { error: '來源未授權' });
      if (origin) { res.setHeader('Access-Control-Allow-Origin', allowed); res.setHeader('Vary', 'Origin'); }
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' }); return res.end(); }
      const url = new URL(req.url, 'http://localhost');
      const route = url.pathname;
      if (!route.startsWith('/api/')) {
        if (req.method !== 'GET') return json(405, { error: '不支援此方法' });
        const files = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/config.js': 'config.js' };
        if (!files[route]) return json(404, { error: '找不到頁面' });
        const file = files[route];
        res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8' });
        return res.end(await readFile(path.join(publicDir, file)));
      }
      res.setHeader('Cache-Control', 'no-store');
      const now = Date.now(), ip = req.socket.remoteAddress;
      if (rates.size > 1000) for (const [k, v] of rates) if (now > v.until) rates.delete(k);
      const rate = rates.get(ip) || { count: 0, until: now + 60000 };
      if (now > rate.until) { rate.count = 0; rate.until = now + 60000; }
      rate.count++; rates.set(ip, rate);
      if (rate.count > 120) return json(429, { error: '請稍後再試' });
      const bearer = req.headers.authorization?.match(/^Bearer ([^\s]+)$/)?.[1] || '';
      const admin = safeEqual(bearer, env.ADMIN_TOKEN);
      let body = {};
      if (req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: '需要 JSON' });
        let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 8192) return json(413, { error: '資料太長' }); }
        try { body = JSON.parse(raw); } catch { return json(400, { error: 'JSON 格式錯誤' }); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: '資料格式錯誤' });
      }
      if (route === '/api/health' && req.method === 'GET') return json(200, { ok: true, appleMode: apple.mode });
      if (route === '/api/orders' && req.method === 'POST') {
        if (!validUdid(body.udid) || typeof body.deviceName !== 'string' || !body.deviceName.trim() || body.deviceName.length > 60 || body.consent !== true) return json(400, { error: '請填寫有效 UDID、裝置名稱並確認測試授權' });
        const token = randomBytes(32).toString('base64url');
        const o = { id: randomUUID(), udid: body.udid.toUpperCase(), deviceName: body.deviceName.trim(), consent: true, createdAt: new Date().toISOString(), paymentStatus: 'unverified', reviewStatus: 'draft', profileStatus: 'none', downloadAuthorized: false };
        db.prepare('INSERT INTO orders VALUES(?,?,?)').run(o.id, hash(token), JSON.stringify(o)); audit(o.id, 'created');
        return json(201, { order: view(o), accessToken: token });
      }
      if (route === '/api/admin/orders' && req.method === 'GET') {
        if (!admin) return json(401, { error: '需要管理員授權' });
        return json(200, db.prepare('SELECT id FROM orders ORDER BY rowid DESC LIMIT 200').all().map(r => view(get(r.id))));
      }
      const m = route.match(/^\/api\/(admin\/)?orders\/([a-f0-9-]{36})(?:\/(demo-skip|review|register|profile|authorize-download|download|audit))?$/);
      if (!m) return json(404, { error: '找不到此介面' });
      const [, adminRoute, id, action] = m;
      if (adminRoute && !admin) return json(401, { error: '需要管理員授權' });
      const o = get(id);
      if (!o || (!adminRoute && !safeEqual(hash(bearer), o.tokenHash))) return json(404, { error: '找不到申請或未獲授權' });
      if (!action && req.method === 'GET') return json(200, view(o));
      if (!adminRoute && action === 'demo-skip' && req.method === 'POST') {
        if (o.reviewStatus === 'draft') { o.reviewStatus = 'pending'; o.demoSkippedAt = new Date().toISOString(); save(o); audit(id, 'demo_payment_skipped_unverified'); }
        return json(200, view(o));
      }
      if (!adminRoute && action === 'download' && req.method === 'GET') {
        if (!o.downloadAuthorized || o.reviewStatus !== 'approved' || o.profileStatus !== 'ready' || !Number.isFinite(Date.parse(o.profileExpires)) || Date.parse(o.profileExpires) <= Date.now() || apple.mode !== 'live') return json(403, { error: '描述檔尚未通過下載授權，或已過期；mock 不提供真實檔案' });
        const bytes = await readFile(path.join(dataDir, 'profiles', `${id}.mobileprovision`));
        audit(id, 'profile_downloaded');
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="AdHoc.mobileprovision"', 'Cache-Control': 'no-store' }); return res.end(bytes);
      }
      if (adminRoute && action === 'audit' && req.method === 'GET') return json(200, db.prepare('SELECT at,action FROM audit WHERE orderId=? ORDER BY id').all(id));
      if (!adminRoute || req.method !== 'POST') return json(405, { error: '不支援此操作' });
      return await locked(id, async () => {
        if (action === 'review') {
          if (!['approved', 'rejected'].includes(body.decision) || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500 || o.reviewStatus === 'draft') return json(400, { error: '需先提交申請並提供審核決定與理由' });
          o.reviewStatus = body.decision; o.reviewReason = body.reason.trim();
          o.downloadAuthorized = false;
        } else if (action === 'register') {
          if (o.reviewStatus !== 'approved') return json(409, { error: '須先經管理員審核' });
          if (!o.appleDeviceId || o.appleDeviceStatus !== 'ENABLED') {
            const device = await apple.registerDevice(o); o.appleDeviceId = device.id; o.appleDeviceStatus = device.status;
          }
        } else if (action === 'profile') {
          if (o.reviewStatus !== 'approved' || o.appleDeviceStatus !== 'ENABLED') return json(409, { error: '需要已審核且啟用的裝置' });
          if (o.profileStatus === 'ready' || o.profileStatus === 'mock') return json(200, view(o));
          const p = await apple.createProfile(o, o.appleDeviceId);
          if (p.mock) { o.profileStatus = 'mock'; }
          else { await writeFile(path.join(dataDir, 'profiles', `${id}.mobileprovision`), p.content, { mode: 0o600 }); o.profileStatus = 'ready'; o.profileExpires = p.expires; }
          o.appleProfileId = p.id; o.downloadAuthorized = false;
        } else if (action === 'authorize-download') {
          if (typeof body.authorized !== 'boolean') return json(400, { error: 'authorized 必須為布林值' });
          if (body.authorized && (o.reviewStatus !== 'approved' || o.profileStatus !== 'ready' || apple.mode !== 'live')) return json(409, { error: '只有正式且經審核的描述檔可授權下載' });
          o.downloadAuthorized = body.authorized;
        } else return json(404, { error: '未知操作' });
        save(o); audit(id, `admin_${action}`); return json(200, view(o));
      });
    } catch (error) {
      // Never log request bodies, bearer tokens, Apple JWTs or private keys.
      console.error('Request failed:', error.status ? 'conflict' : 'operation-error');
      if (!res.headersSent) json(error.status || 502, { error: error.status ? error.message : '處理失敗，請由管理員檢查設定、Apple 狀態及網路後再試' });
      else res.end();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return { server, close: () => db.close() };
}
