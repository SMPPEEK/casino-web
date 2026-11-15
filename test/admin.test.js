'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.DEMO = '1';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-admin-'));
process.env.ADMIN_EMAIL = 'Admin@Ejemplo.com';
process.env.ADMIN_PASSWORD = 'clave-de-administrador-larga';
const GOOD = { email: 'admin@ejemplo.com ', password: process.env.ADMIN_PASSWORD };
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('../server');

let base; let server;
const jar = { sid: '', adm: '' };
async function call(method, url, body, cookies = []) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const c = cookies.map((k) => jar[k] && `${k}=${jar[k]}`).filter(Boolean).join('; ');
  if (c) headers.Cookie = c;
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const sc of res.headers.getSetCookie?.() || []) { const [k, v] = sc.split(';')[0].split('='); if (v) jar[k] = v; }
  let data = {}; try { data = await res.json(); } catch { /* vacío */ }
  return { status: res.status, data };
}
test.before(async () => { server = await start(0, '127.0.0.1'); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());

test('el panel no responde sin la clave de administrador (ni con sesión de jugador)', async () => {
  assert.strictEqual((await call('GET', '/api/admin/overview')).status, 401);
  assert.strictEqual((await call('POST', '/api/auth/login', { code: 'ADMIN001' })).status, 200);
  assert.strictEqual((await call('GET', '/api/admin/overview', undefined, ['sid'])).status, 401, 'una cuenta de jugador no alcanza');
  assert.strictEqual((await call('POST', '/api/admin/login', { email: 'admin@ejemplo.com', password: 'mala' })).status, 401);
  assert.strictEqual((await call('POST', '/api/admin/login', { email: 'otro@ejemplo.com', password: process.env.ADMIN_PASSWORD })).status, 401, 'correo equivocado');
  assert.strictEqual((await call('POST', '/api/admin/login', { password: process.env.ADMIN_PASSWORD })).status, 401, 'sin correo');
  assert.strictEqual((await call('GET', '/api/admin/overview', undefined, ['adm'])).status, 401);
});

test('con la clave se ven ingresos (IP y nombre) y resultados por juego', async () => {
  await call('POST', '/api/cashier/in', { amount: 500 }, ['sid']);
  for (let i = 0; i < 5; i++) await call('POST', '/api/games/coinflip/flip', { bet: 10, side: 'heads' }, ['sid']);
  assert.strictEqual((await call('POST', '/api/admin/login', GOOD)).status, 200);
  const r = await call('GET', '/api/admin/overview', undefined, ['adm']);
  assert.strictEqual(r.status, 200);
  const p = r.data.players.find((x) => x.name.startsWith('Demo_ADMIN0'));
  assert.ok(p, 'aparece el jugador');
  assert.strictEqual(p.ips.length, 1);
  assert.match(p.ips[0].ip, /127\.0\.0\.1|::1|::ffff:127\.0\.0\.1/);
  assert.strictEqual(p.logins, 1);
  assert.ok(r.data.logins.some((l) => l.name === p.name && l.ip));
  const g = r.data.games.find((x) => x.game === 'coinflip');
  assert.strictEqual(g.rounds, 5);
  assert.strictEqual(g.wagered, 50);
  assert.strictEqual(g.house, g.wagered - g.paid);
  assert.strictEqual(p.games.coinflip.net, p.games.coinflip.paid - 50);
  assert.strictEqual(r.data.recent.length, 5);
});

test('cerrar sesión de administrador la invalida', async () => {
  await call('POST', '/api/admin/logout', {}, ['adm']);
  assert.strictEqual((await call('GET', '/api/admin/overview', undefined, ['adm'])).status, 401);
});

test('eventos para los avisos: ingresos, jugadas grandes y fallos del puente', async () => {
  const events = require('../lib/events');
  await call('POST', '/api/admin/login', GOOD);
  const first = await call('GET', '/api/admin/events', undefined, ['adm']);
  assert.strictEqual(first.status, 200);
  assert.deepStrictEqual(first.data.events, [], 'sin since: solo lo que venga de ahora en más');
  const base = first.data.last;
  assert.strictEqual((await call('POST', '/api/auth/login', { code: 'AVISO001' })).status, 200);
  events.emit('round', { name: 'X', game: 'slots', stake: 100, payout: 9000, net: 8900 });
  events.bridgeError('unreachable', 'sin conexión');
  events.bridgeError('unreachable', 'sin conexión');   // repetido: se descarta
  const r = await call('GET', '/api/admin/events?since=' + base, undefined, ['adm']);
  assert.deepStrictEqual(r.data.events.map((e) => e.type), ['login', 'round', 'bridge']);
  assert.ok(r.data.events[0].name.startsWith('Demo_AVISO0') && r.data.events[0].ip);
  const again = await call('GET', '/api/admin/events?since=' + r.data.last, undefined, ['adm']);
  assert.deepStrictEqual(again.data.events, []);
  assert.strictEqual((await call('GET', '/api/admin/events', undefined, [])).status, 401);
});
