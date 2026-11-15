'use strict';
// Prueba de integración completa contra el servidor en modo demo (sin Minecraft).
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DEMO = '1';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-test-'));
process.env.MAX_BET = '5000';

const test = require('node:test');
const assert = require('node:assert');
const { start } = require('../server');

let base;
let server;
let cookie = '';

async function call(method, url, body, opts = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = opts.contentType || 'application/json';
  if (cookie && !opts.noCookie) headers.Cookie = cookie;
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : (opts.raw ? body : JSON.stringify(body)) });
  const sc = res.headers.getSetCookie && res.headers.getSetCookie()[0];
  if (sc && !opts.noCookie && sc.startsWith('sid=') && !sc.startsWith('sid=;')) cookie = sc.split(';')[0];
  let data = {};
  try { data = await res.json(); } catch { /* vacío */ }
  return { status: res.status, data, res };
}

test.before(async () => {
  server = await start(0, '127.0.0.1');
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); });

test('sin sesión no se puede jugar ni ver el saldo', async () => {
  for (const [m, u, b] of [['GET', '/api/me'], ['POST', '/api/games/slots/spin', { bet: 1 }], ['POST', '/api/cashier/in', { amount: 10 }]]) {
    const r = await call(m, u, b, { noCookie: true });
    assert.strictEqual(r.status, 401, u);
  }
});

test('configuración pública y cabeceras de seguridad', async () => {
  const r = await call('GET', '/api/config', undefined, { noCookie: true });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.demo, true);
  assert.strictEqual(r.data.maxBet, 5000);
  assert.ok(r.res.headers.get('content-security-policy').includes("script-src 'self'"));
  assert.strictEqual(r.res.headers.get('x-frame-options'), 'DENY');
  const page = await fetch(base + '/');
  assert.strictEqual(page.status, 200);
  assert.ok((await page.text()).includes('<title>'));
});

test('no sirve archivos fuera de /public', async () => {
  for (const p of ['/../server.js', '/..%2fserver.js', '/%2e%2e/package.json', '/js/../../.env.example']) {
    const r = await fetch(base + p);
    assert.notStrictEqual(r.status, 200, p);
  }
});

test('login: código inválido y válido', async () => {
  let r = await call('POST', '/api/auth/login', { code: '!!' }, { noCookie: true });
  assert.strictEqual(r.status, 400);
  r = await call('POST', '/api/auth/login', { code: 'TESTCODE1' });
  assert.strictEqual(r.status, 200);
  assert.ok(cookie.startsWith('sid='));
  const sc = r.res.headers.getSetCookie()[0];
  assert.ok(sc.includes('HttpOnly') && sc.includes('SameSite=Strict'));
  r = await call('GET', '/api/me');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.balance, 0);
});

test('CSRF: un POST que no sea JSON se rechaza', async () => {
  const r = await call('POST', '/api/games/coinflip/flip', 'bet=1&side=heads', { contentType: 'application/x-www-form-urlencoded', raw: true });
  assert.strictEqual(r.status, 415);
});

test('cajero: cargar fichas desde Minecraft', async () => {
  let r = await call('GET', '/api/cashier');
  assert.strictEqual(r.data.mcBalance, 10000);
  for (const amount of [0, -5, 1.5, '100', null, 100001]) {
    r = await call('POST', '/api/cashier/in', { amount });
    assert.strictEqual(r.status, 400, String(amount));
  }
  r = await call('POST', '/api/cashier/in', { amount: 20000 });
  assert.strictEqual(r.status, 402); // más de lo que tiene en el servidor
  assert.strictEqual(r.data.error, 'mc_insufficient_funds');
  r = await call('POST', '/api/cashier/in', { amount: 6000 });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.balance, 6000);
  r = await call('GET', '/api/cashier');
  assert.strictEqual(r.data.mcBalance, 4000);
});

test('apuestas inválidas se rechazan sin tocar el saldo', async () => {
  const cases = [
    ['/api/games/slots/spin', { bet: 0 }], ['/api/games/slots/spin', { bet: 1.5 }], ['/api/games/slots/spin', { bet: '10' }],
    ['/api/games/slots/spin', { bet: 5001 }], ['/api/games/slots/spin', {}], ['/api/games/slots/spin', { bet: -10 }],
    ['/api/games/dice/roll', { bet: 10, mode: 'under', target: 1 }], ['/api/games/dice/roll', { bet: 10, mode: 'x', target: 50 }],
    ['/api/games/coinflip/flip', { bet: 10, side: 'edge' }],
    ['/api/games/roulette/spin', { bets: [] }], ['/api/games/roulette/spin', { bets: [{ type: 'red', amount: 99999 }] }],
  ];
  for (const [u, b] of cases) {
    const r = await call('POST', u, b);
    assert.strictEqual(r.status, 400, `${u} ${JSON.stringify(b)}`);
  }
  const me = await call('GET', '/api/me');
  assert.strictEqual(me.data.balance, 6000);
});

test('sin saldo suficiente no se puede apostar', async () => {
  const r = await call('POST', '/api/games/slots/spin', { bet: 5000 });
  assert.strictEqual(r.status, 200); // 6000 alcanza
  const me = await call('GET', '/api/me');
  const bal = me.data.balance;
  // vaciar casi todo y probar que falla
  await call('POST', '/api/cashier/out', { amount: bal - 3 });
  const r2 = await call('POST', '/api/games/slots/spin', { bet: 4 });
  assert.strictEqual(r2.status, 402);
  const back = await call('POST', '/api/cashier/in', { amount: 3000 });
  assert.strictEqual(back.status, 200);
});

test('cada juego mantiene la contabilidad: saldo final = saldo inicial − apuesta + premio', async () => {
  let me = (await call('GET', '/api/me')).data;
  let bal = me.balance;
  const check = async (url, body) => {
    const r = await call('POST', url, body);
    assert.strictEqual(r.status, 200, url + JSON.stringify(r.data));
    assert.strictEqual(r.data.balance, bal - r.data.stake + r.data.payout, url);
    bal = r.data.balance;
    return r.data;
  };
  for (let i = 0; i < 25; i++) {
    const s = await check('/api/games/slots/spin', { bet: 10 });
    assert.strictEqual(s.reels.length, 3);
    await check('/api/games/dice/roll', { bet: 10, mode: i % 2 ? 'under' : 'over', target: i % 2 ? 50 : 60 });
    await check('/api/games/coinflip/flip', { bet: 10, side: i % 2 ? 'heads' : 'tails' });
    const rl = await check('/api/games/roulette/spin', { bets: [{ type: 'red', amount: 5 }, { type: 'straight', value: 7, amount: 1 }, { type: 'dozen', value: 2, amount: 2 }] });
    assert.strictEqual(rl.stake, 8);
    assert.ok(rl.number >= 0 && rl.number <= 36);
  }
  me = (await call('GET', '/api/me')).data;
  assert.strictEqual(me.balance, bal);
  assert.ok(me.history.length > 0 && me.history.length <= 10);
});

test('blackjack: flujo completo, mano persistente y sin trampas', async () => {
  let bal = (await call('GET', '/api/me')).data.balance;
  let played = 0;
  let sawActive = false;
  while (played < 40) {
    const d = await call('POST', '/api/games/blackjack/deal', { bet: 20 });
    assert.strictEqual(d.status, 200);
    const view = d.data.hand;
    assert.ok(!('deck' in view));
    if (view.done) { bal = d.data.balance; played++; continue; }
    sawActive = true;
    assert.strictEqual(view.dealer[1], null, 'la carta oculta no debe viajar al cliente');
    // otra mano mientras hay una en curso: rechazada
    assert.strictEqual((await call('POST', '/api/games/blackjack/deal', { bet: 20 })).status, 409);
    // la mano sobrevive a "recargar la página"
    const me = (await call('GET', '/api/me')).data;
    assert.ok(me.hand && !me.hand.done && me.hand.dealer[1] === null);
    assert.strictEqual(me.balance, d.data.balance);
    let r;
    if (view.canDouble && played % 3 === 0) r = await call('POST', '/api/games/blackjack/double', {});
    else if (view.playerTotal < 12) { r = await call('POST', '/api/games/blackjack/hit', {}); if (!r.data.hand.done) r = await call('POST', '/api/games/blackjack/stand', {}); }
    else r = await call('POST', '/api/games/blackjack/stand', {});
    assert.strictEqual(r.status, 200);
    assert.ok(r.data.hand.done);
    assert.strictEqual(r.data.balance, d.data.balance - (r.data.stake - 20) + r.data.payout, 'saldo tras terminar la mano');
    bal = r.data.balance;
    // ya no hay mano activa
    assert.strictEqual((await call('POST', '/api/games/blackjack/hit', {})).status, 409);
    played++;
  }
  assert.ok(sawActive);
  assert.strictEqual((await call('GET', '/api/me')).data.balance, bal);
});

test('retirar fichas al servidor y que el dinero llegue', async () => {
  const me = (await call('GET', '/api/me')).data;
  const mcBefore = (await call('GET', '/api/cashier')).data.mcBalance;
  const r = await call('POST', '/api/cashier/out', { amount: 500 });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.balance, me.balance - 500);
  assert.strictEqual((await call('GET', '/api/cashier')).data.mcBalance, mcBefore + 500);
  assert.strictEqual((await call('POST', '/api/cashier/out', { amount: me.balance * 10 })).status, 402);
});

test('chicken road: ronda persistente, sin cobrar en cero y sin rondas dobles', async () => {
  const s = await call('POST', '/api/games/chicken/start', { bet: 10, level: 'easy' });
  assert.strictEqual(s.status, 200);
  assert.strictEqual((await call('POST', '/api/games/chicken/start', { bet: 10, level: 'easy' })).status, 409);
  assert.strictEqual((await call('POST', '/api/games/chicken/cashout', {})).status, 400);
  let r;
  do { r = await call('POST', '/api/games/chicken/step', {}); } while (r.status === 200 && !r.data.round.done && r.data.round.step < 3);
  if (!r.data.round.done) r = await call('POST', '/api/games/chicken/cashout', {});
  assert.ok(r.data.round.done);
  assert.strictEqual((await call('POST', '/api/games/chicken/step', {})).status, 409);
  assert.strictEqual((await call('POST', '/api/games/chicken/start', { bet: 10, level: 'nope' })).status, 400);
});

test('el libro mayor (ledger.log) cuadra con el saldo', async () => {
  const me = (await call('GET', '/api/me')).data;
  const lines = fs.readFileSync(path.join(process.env.DATA_DIR, 'ledger.log'), 'utf8').trim().split('\n');
  let sum = 0;
  for (const l of lines) sum += Number(l.split(',')[3]);
  assert.strictEqual(sum, me.balance);
  const last = lines[lines.length - 1].split(',');
  assert.strictEqual(Number(last[4]), me.balance);
});

test('cabezas: exigen sesión y solo aceptan ids válidos (sin tocar la red)', async () => {
  const anon = await call('GET', '/api/avatar/Steve', undefined, { noCookie: true });
  assert.strictEqual(anon.status, 401);
  for (const bad of ['..%2Fetc', 'a%20b', 'x'.repeat(40)]) {
    assert.strictEqual((await call('GET', '/api/avatar/' + bad)).status, 400, bad);
  }
  const csp = (await call('GET', '/api/config', undefined, { noCookie: true })).res.headers.get('content-security-policy');
  assert.ok(!csp.includes('mc-heads'), 'la política ya no permite imágenes de terceros');
});

test('cerrar sesión invalida la cookie', async () => {
  const old = cookie;
  await call('POST', '/api/auth/logout', {});
  cookie = old;
  assert.strictEqual((await call('GET', '/api/me')).status, 401);
  const r = await call('GET', '/api/session');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body?.logged ?? r.data?.logged, false);
});

test('limitador de login: tras muchos intentos responde 429', async () => {
  let last;
  for (let i = 0; i < 14; i++) last = await call('POST', '/api/auth/login', { code: 'BADCODE' + i }, { noCookie: true });
  // en modo demo cualquier código es válido, pero el límite por IP corta igual
  assert.strictEqual(last.status, 429);
});

test('aviso legal: la página existe y la portada aclara que las fichas no tienen valor real', async () => {
  const res = await fetch(base + '/legal.html');
  assert.strictEqual(res.status, 200);
  const html = await res.text();
  assert.match(html, /no tienen valor monetario/i);
  assert.match(html, /Mojang/);
  const idx = await (await fetch(base + '/')).text();
  assert.match(idx, /no tienen valor monetario/i);
  assert.match(idx, /id="login-legal"[^>]*required/);
});
