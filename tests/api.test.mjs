import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp, validUdid } from '../server/app.mjs';
import { createApple } from '../server/apple.mjs';

test('UDID validation and fail-closed Apple configuration', () => {
  assert.ok(validUdid('00008110-001234567890001E'));
  assert.ok(validUdid('a'.repeat(40)));
  assert.ok(!validUdid('invalid'));
  assert.throws(() => createApple({ APPLE_MODE: 'live' }));
  assert.throws(() => createApple({ APPLE_KEY_ID: 'partial' }));
});

test('demo skip never pays, approves, provisions or grants downloads; owner isolation and admin gates', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'adhoc-test-'));
  const admin = 'test-admin-'.repeat(5);
  const app = await createApp({ env: { ADMIN_TOKEN: admin, ALLOWED_ORIGIN: 'http://localhost:3000' }, dataDir: dir });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (p, method = 'GET', body, token, origin) => {
    const r = await fetch(base + p, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origin ? { Origin: origin } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json() };
  };
  try {
    assert.equal((await call('/api/orders', 'POST', { udid: 'bad' })).status, 400);
    const made = await call('/api/orders', 'POST', { deviceName: '<script>alert(1)</script>', udid: '00008110-001234567890001E', consent: true });
    assert.equal(made.status, 201);
    const { order, accessToken } = made.data;
    const p = `/api/orders/${order.id}`, a = `/api/admin/orders/${order.id}`;
    assert.equal((await call(p)).status, 404);
    assert.equal((await call(p, 'GET', undefined, 'wrong')).status, 404);
    assert.equal((await call('/api/admin/orders', 'GET', undefined, accessToken)).status, 401);
    assert.equal((await call(p, 'GET', undefined, accessToken, 'https://evil.example')).status, 403);
    assert.equal((await call(a + '/register', 'POST', {}, admin)).status, 409);
    assert.equal((await call(a + '/profile', 'POST', {}, admin)).status, 409);
    const skipped = await call(p + '/demo-skip', 'POST', { paymentStatus: 'paid', reviewStatus: 'approved', downloadAuthorized: true }, accessToken);
    assert.equal(skipped.data.paymentStatus, 'unverified');
    assert.equal(skipped.data.reviewStatus, 'pending');
    assert.equal(skipped.data.profileStatus, 'none');
    assert.equal(skipped.data.downloadAuthorized, false);
    assert.equal((await call(p + '/download', 'GET', undefined, accessToken)).status, 403);
    assert.equal((await call(a + '/review', 'POST', { decision: 'approved', reason: 'Authorized app tester' }, admin)).status, 200);
    assert.equal((await call(a + '/register', 'POST', {}, admin)).status, 200);
    const profile = await call(a + '/profile', 'POST', {}, admin);
    assert.equal(profile.data.profileStatus, 'mock');
    assert.equal((await call(a + '/authorize-download', 'POST', { authorized: true }, admin)).status, 409);
    assert.equal((await call(p + '/download', 'GET', undefined, accessToken)).status, 403);
    assert.equal((await call(p + '/demo-skip', 'POST', {}, accessToken)).data.reviewStatus, 'approved');
    const audit = await call(a + '/audit', 'GET', undefined, admin);
    assert.ok(audit.data.some(x => x.action === 'demo_payment_skipped_unverified'));
    assert.ok(!JSON.stringify(audit.data).includes(accessToken));
    assert.equal((await call('/.env')).status, 404);
  } finally {
    await new Promise(resolve => app.server.close(resolve)); app.close(); await rm(dir, { recursive: true, force: true });
  }
});

test('live-profile download requires separate authorization and can be revoked', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'adhoc-test-'));
  const admin = 'test-admin-'.repeat(5);
  // Injected stub: exercises real-mode gates without contacting Apple or creating a valid profile.
  const apple = { mode: 'live', registerDevice: async () => ({ id: 'device', status: 'ENABLED' }), createProfile: async () => ({ id: 'profile', content: Buffer.from('test-fixture'), expires: new Date(Date.now() + 3600000).toISOString() }) };
  const app = await createApp({ env: { ADMIN_TOKEN: admin }, dataDir: dir, apple });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const call = (p, token, body) => fetch(`http://127.0.0.1:${app.server.address().port}${p}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  try {
    const { order, accessToken } = await (await call('/api/orders', '', { deviceName: 'Test', udid: 'a'.repeat(40), consent: true })).json();
    const p = `/api/orders/${order.id}`, a = `/api/admin/orders/${order.id}`;
    await call(p + '/demo-skip', accessToken, {});
    await call(a + '/review', admin, { decision: 'approved', reason: 'Authorized' });
    await call(a + '/register', admin, {});
    await call(a + '/profile', admin, {});
    assert.equal((await call(p + '/download', accessToken)).status, 403);
    await call(a + '/authorize-download', admin, { authorized: true });
    const download = await call(p + '/download', accessToken);
    assert.equal(download.status, 200); assert.equal(await download.text(), 'test-fixture');
    await call(a + '/authorize-download', admin, { authorized: false });
    assert.equal((await call(p + '/download', accessToken)).status, 403);
    await call(a + '/review', admin, { decision: 'rejected', reason: 'Authorization withdrawn' });
    assert.equal((await call(a + '/authorize-download', admin, { authorized: true })).status, 409);
  } finally {
    await new Promise(resolve => app.server.close(resolve)); app.close(); await rm(dir, { recursive: true, force: true });
  }
});
