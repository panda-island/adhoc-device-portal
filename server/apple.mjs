import { readFile } from 'node:fs/promises';
import { createPrivateKey, sign } from 'node:crypto';

export function createApple(env = process.env) {
  const mode = env.APPLE_MODE || 'mock';
  if (!['mock', 'live'].includes(mode)) throw Error('Invalid APPLE_MODE');
  const keys = ['APPLE_KEY_ID', 'APPLE_ISSUER_ID', 'APPLE_PRIVATE_KEY_PATH'];
  if (mode === 'mock' && keys.some(k => env[k])) throw Error('Remove Apple credentials in mock mode');
  if (mode === 'live' && keys.some(k => !env[k])) throw Error('Incomplete Apple configuration');
  async function request(path, method = 'GET', body) {
    const now = Math.floor(Date.now() / 1000);
    const encode = x => Buffer.from(JSON.stringify(x)).toString('base64url');
    const input = `${encode({ alg: 'ES256', kid: env.APPLE_KEY_ID, typ: 'JWT' })}.${encode({ iss: env.APPLE_ISSUER_ID, iat: now, exp: now + 120, aud: 'appstoreconnect-v1' })}`;
    const key = createPrivateKey(await readFile(env.APPLE_PRIVATE_KEY_PATH));
    const jwt = `${input}.${sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
    const response = await fetch(`https://api.appstoreconnect.apple.com/v1/${path}`, {
      method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw Error(`Apple API ${response.status}; check server configuration and Apple account`);
    return response.json();
  }
  return {
    mode,
    async registerDevice(order) {
      if (mode === 'mock') return { id: `mock-${order.id}`, status: 'ENABLED' };
      const found = await request(`devices?filter[udid]=${encodeURIComponent(order.udid)}`);
      const device = found.data?.[0] || (await request('devices', 'POST', { data: { type: 'devices', attributes: { name: order.deviceName, platform: 'IOS', udid: order.udid } } })).data;
      return { id: device.id, status: device.attributes.status };
    },
    async createProfile(order, deviceId) {
      if (mode === 'mock') return { id: `mock-profile-${order.id}`, mock: true };
      if (!env.APPLE_BUNDLE_ID_RESOURCE || !env.APPLE_CERTIFICATE_RESOURCE) throw Error('Missing profile resource IDs');
      const relation = (type, id) => ({ type, id });
      const result = await request('profiles', 'POST', { data: { type: 'profiles', attributes: { name: `AdHoc-${order.id}`, profileType: 'IOS_APP_ADHOC' }, relationships: {
        bundleId: { data: relation('bundleIds', env.APPLE_BUNDLE_ID_RESOURCE) },
        certificates: { data: [relation('certificates', env.APPLE_CERTIFICATE_RESOURCE)] },
        devices: { data: [relation('devices', deviceId)] }
      } } });
      const a = result.data.attributes;
      if (a.profileState !== 'ACTIVE' || !a.profileContent || !Number.isFinite(Date.parse(a.expirationDate)) || Date.parse(a.expirationDate) <= Date.now()) throw Error('Apple profile is not active');
      return { id: result.data.id, content: Buffer.from(a.profileContent, 'base64'), expires: a.expirationDate };
    }
  };
}
