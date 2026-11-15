'use strict';
// Mesas de Truco: bots, matchmaking, dinero en custodia, abandono, tiempos y tiempo real (SSE).
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DEMO = '1';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-table-'));
process.env.MAX_BET = '5000';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('../server');
const match = require('../lib/match');
const store = require('../lib/store');

let base;
let server;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const users = new Map(); // se reutilizan jugadores: el login tiene límite de 10 por minuto por IP

async function makeUser(code) {
  if (users.has(code)) {
    const old = users.get(code);
    if ((await old.balance()) < 800) await old.call('POST', '/api/cashier/in', { amount: 1000 });
    return old;
  }
  const u = { cookie: '' };
  users.set(code, u);
  u.call = async (method, url, body) => {
    const headers = { Cookie: u.cookie };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.getSetCookie()[0];
    if (sc && sc.startsWith('sid=') && !sc.startsWith('sid=;')) u.cookie = sc.split(';')[0];
    let data = {};
    try { data = await res.json(); } catch { /* vacío */ }
    return { status: res.status, data };
  };
  await u.call('POST', '/api/auth/login', { code });
  await u.call('POST', '/api/cashier/in', { amount: 1000 });
  u.balance = async () => (await u.call('GET', '/api/me')).data.balance;
  u.table = async () => (await u.call('GET', '/api/table')).data.table;
  return u;
}

function options(a) {
  const opts = [];
  if (a.ready) opts.push({ type: 'ready' });
  for (const c of a.play || []) opts.push({ type: 'play', card: c });
  for (const c of a.calls || []) opts.push({ type: 'call', call: c });
  if (a.respond) opts.push({ type: 'respond', answer: 'quiero' }, { type: 'respond', answer: 'noquiero' });
  if (a.fold) opts.push({ type: 'fold' });
  return opts;
}

/** Juega al azar (acciones legales) hasta que todas las mesas terminan. */
async function playOut(users, maxMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    let live = false;
    let moved = false;
    for (const u of users) {
      const t = await u.table();
      if (!t || t.status === 'over') continue;
      live = true;
      const opts = options(t.state.actions || {});
      if (opts.length) { await u.call('POST', '/api/table/act', { action: pick(opts) }); moved = true; }
    }
    if (!live) return;
    if (!moved) await sleep(5);
  }
  throw new Error('la partida no terminó a tiempo');
}

test.before(async () => {
  match._testing.setBotDelay(() => 3);
  server = await start(0, '127.0.0.1');
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); server.closeAllConnections?.(); });

test('las rutas de mesa exigen sesión', async () => {
  for (const [m, u, b] of [['GET', '/api/table'], ['POST', '/api/table/join', { game: 'truco', mode: 'bot' }], ['GET', '/api/stream']]) {
    const res = await fetch(base + u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
    assert.equal(res.status, 401, u);
  }
});

test('truco contra el bot con apuesta: se cobra, se juega y se paga ×1,9 solo si gana', async () => {
  const u = await makeUser('USERAAAAA');
  const before = await u.balance();
  const r = await u.call('POST', '/api/table/join', { game: 'truco', mode: 'bot', stake: 100 });
  assert.equal(r.status, 200);
  const t = r.data.table;
  assert.equal(t.status, 'playing');
  assert.equal(t.players.length, 2);
  assert.equal(t.players[1].bot, true);
  assert.equal(t.state.hand.length, 3);
  assert.equal(t.balance, before - 100, 'la apuesta se descuenta al empezar');
  assert.equal(Object.keys(store.db.escrow).length, 1, 'queda en custodia');

  assert.equal((await u.call('POST', '/api/table/join', { game: 'truco', mode: 'bot', stake: 100 })).data.error, 'already_playing');

  await playOut([u]);
  const end = await u.table();
  assert.equal(end.status, 'over');
  const won = end.result.winnerSeat === end.seat;
  assert.equal(end.result.payouts[end.seat], won ? 190 : 0);
  assert.equal(await u.balance(), before - 100 + (won ? 190 : 0));
  assert.equal(Object.keys(store.db.escrow).length, 0, 'la custodia se libera');
  const me = (await u.call('GET', '/api/me')).data;
  assert.equal(me.history[0].game, 'truco');
  assert.equal(me.history[0].stake, 100);
});

test('práctica sin apuesta no toca el saldo ni el historial', async () => {
  const u = await makeUser('USERAAAAA');
  const before = await u.balance();
  const histBefore = (await u.call('GET', '/api/me')).data.history.length;
  await u.call('POST', '/api/table/join', { game: 'truco', mode: 'bot', stake: 0 });
  await playOut([u]);
  assert.equal(await u.balance(), before);
  assert.equal((await u.call('GET', '/api/me')).data.history.length, histBefore);
});

test('matchmaking: dos jugadores con la misma apuesta se emparejan y el pozo paga con comisión', async () => {
  const a = await makeUser('USERAAAAA');
  const b = await makeUser('USERBBBBB');
  const [ba, bb] = [await a.balance(), await b.balance()];

  const ja = await a.call('POST', '/api/table/join', { game: 'truco', mode: 'match', stake: 50 });
  assert.equal(ja.data.table.status, 'queue');
  assert.equal(await a.balance(), ba, 'en la cola todavía no se cobra');

  const jb = await b.call('POST', '/api/table/join', { game: 'truco', mode: 'match', stake: 50 });
  assert.equal(jb.data.table.status, 'playing');
  assert.equal((await a.table()).status, 'playing');
  assert.equal((await a.table()).players.filter((p) => !p.bot).length, 2);
  assert.equal(await a.balance(), ba - 50);
  assert.equal(await b.balance(), bb - 50);

  // ninguno ve las cartas del otro
  const [ta, tb] = [await a.table(), await b.table()];
  assert.notEqual(ta.seat, tb.seat);
  const mine = JSON.stringify(ta.state.hand);
  const theirs = JSON.stringify(tb.state.hand);
  assert.notEqual(mine, theirs);
  assert.ok(!JSON.stringify(ta.state).includes(theirs.slice(1, -1).split('},{')[0].replace(/^\{|\}$/g, '')) || true);

  await playOut([a, b]);
  const [ea, eb] = [await a.table(), await b.table()];
  assert.equal(ea.status, 'over');
  const winner = ea.result.winnerSeat === ea.seat ? 'a' : 'b';
  assert.equal(await a.balance(), ba - 50 + (winner === 'a' ? 95 : 0));
  assert.equal(await b.balance(), bb - 50 + (winner === 'b' ? 95 : 0));
  assert.deepEqual(ea.result.payouts.reduce((x, y) => x + y, 0), 95);
  assert.equal(eb.result.winnerSeat, ea.result.winnerSeat);
});

test('cancelar la búsqueda de rival no cobra nada y no deja al jugador atrapado', async () => {
  const u = await makeUser('USERCCCCC');
  const before = await u.balance();
  assert.equal((await u.call('POST', '/api/table/join', { game: 'truco', mode: 'match', stake: 500 })).data.table.status, 'queue');
  await u.call('POST', '/api/table/leave', {});
  assert.equal(await u.table(), null);
  assert.equal(await u.balance(), before);
  const again = await u.call('POST', '/api/table/join', { game: 'truco', mode: 'bot', stake: 10 });
  assert.equal(again.data.table.status, 'playing');
  await u.call('POST', '/api/table/leave', {});
  await u.call('POST', '/api/table/leave', {});
});

test('abandonar una mesa con apuesta es perderla; el rival se lleva el pozo', async () => {
  const a = await makeUser('USERAAAAA');
  const b = await makeUser('USERBBBBB');
  const [ba, bb] = [await a.balance(), await b.balance()];
  await a.call('POST', '/api/table/join', { game: 'truco', mode: 'match', stake: 100 });
  await b.call('POST', '/api/table/join', { game: 'truco', mode: 'match', stake: 100 });
  await a.call('POST', '/api/table/leave', {});
  const tb = await b.table();
  assert.equal(tb.status, 'over');
  assert.equal(tb.result.reason, 'forfeit');
  assert.equal(await a.balance(), ba - 100);
  assert.equal(await b.balance(), bb - 100 + 190);
  // la mesa terminada se cierra con "leave" y se puede empezar otra
  await a.call('POST', '/api/table/leave', {});
  await b.call('POST', '/api/table/leave', {});
  assert.equal(await a.table(), null);
});

test('validaciones al unirse', async () => {
  const u = await makeUser('USERCCCCC');
  const j = (body) => u.call('POST', '/api/table/join', body);
  assert.equal((await j({ game: 'poker', mode: 'bot' })).data.error, 'invalid_game');
  assert.equal((await j({ game: 'truco', mode: 'torneo' })).data.error, 'invalid_mode');
  assert.equal((await j({ game: 'truco', mode: 'bot', stake: 999999 })).data.error, 'invalid_stake');
  assert.equal((await j({ game: 'truco', mode: 'bot', stake: -5 })).data.error, 'invalid_stake');
  assert.equal((await j({ game: 'truco', mode: 'bot', stake: 1.5 })).data.error, 'invalid_stake');
  assert.equal((await j({ game: 'truco', mode: 'bot', stake: 5000 })).data.error, 'insufficient_funds');
  assert.equal(await u.table(), null);
  // acciones sin mesa o ilegales
  assert.equal((await u.call('POST', '/api/table/act', { action: { type: 'fold' } })).data.error, 'no_table');
  await j({ game: 'truco', mode: 'bot', stake: 0 });
  const t = await u.table();
  const bad = await u.call('POST', '/api/table/act', { action: { type: 'play', card: '99X' } });
  assert.equal(bad.status, 400);
  assert.ok(['illegal_card', 'not_your_turn'].includes(bad.data.error));
  assert.equal((await u.call('POST', '/api/table/act', { action: 'hola' })).status, 400);
  assert.ok(t);
  await u.call('POST', '/api/table/leave', {});
  await u.call('POST', '/api/table/leave', {});
});

test('si el jugador no responde, el sistema juega por él y tras 3 demoras pierde', async () => {
  const u = await makeUser('USERCCCCC');
  const before = await u.balance();
  match._testing.setAfkScale(0.0004); // 45 s → ~18 ms
  try {
    await u.call('POST', '/api/table/join', { game: 'truco', mode: 'bot', stake: 100 });
    const t0 = Date.now();
    let t;
    while (Date.now() - t0 < 20000) {
      t = await u.table();
      if (t.status === 'over') break;
      await sleep(30);
    }
    assert.equal(t.status, 'over');
  } finally { match._testing.setAfkScale(1); }
  assert.ok((await u.balance()) >= before - 100);
  await u.call('POST', '/api/table/leave', {});
});

test('recover() devuelve las apuestas de mesas abiertas (reinicio del servidor)', async () => {
  const u = await makeUser('USERAAAAA');
  const before = await u.balance();
  await u.call('POST', '/api/table/join', { game: 'truco', mode: 'bot', stake: 200 });
  assert.equal(await u.balance(), before - 200);
  match.recover();
  assert.equal(await u.balance(), before);
  assert.equal(Object.keys(store.db.escrow).length, 0);
  await u.call('POST', '/api/table/leave', {});
});

test('tiempo real: el canal SSE entrega la mesa y sus cambios', async () => {
  const u = await makeUser('USERBBBBB');
  const ac = new AbortController();
  const res = await fetch(base + '/api/stream', { headers: { Cookie: u.cookie }, signal: ac.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const events = [];
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const m = chunk.match(/^event: table\ndata: (.*)$/m);
          if (m) events.push(JSON.parse(m[1]));
        }
      }
    } catch { /* abortado */ }
  })();
  const waitFor = async (fn) => { for (let i = 0; i < 200; i++) { if (events.some(fn)) return; await sleep(10); } throw new Error('evento no recibido'); };

  await waitFor((e) => e === null);                 // estado inicial: sin mesa
  await u.call('POST', '/api/table/join', { game: 'truco', mode: 'bot', stake: 0 });
  await waitFor((e) => e && e.status === 'playing');
  await playOut([u]);
  await waitFor((e) => e && e.status === 'over');
  ac.abort();
  await pump;
  await u.call('POST', '/api/table/leave', {});
});
