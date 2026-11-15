'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./lib/config');
const store = require('./lib/store');
const bridge = require('./lib/bridge');
const games = require('./lib/games');
const chicken = require('./lib/chicken');
const avatar = require('./lib/avatar');
const admin = require('./lib/admin');
const events = require('./lib/events');
const match = require('./lib/match');

const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
};

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

// ------------------------------------------------------------------ utilidades
const buckets = new Map();
function rate(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  if (++b.n > max) throw new HttpError(429, 'rate_limited');
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 60000).unref();

function clientIp(req) {
  if (cfg.trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return xff.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 16384) { reject(new HttpError(413, 'too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new HttpError(400, 'bad_json')); }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignorar */ } }
  }
  return out;
}

function int(v, min, max, code) {
  if (!Number.isInteger(v) || v < min || v > max) throw new HttpError(400, code);
  return v;
}
const betOf = (v) => int(v, cfg.minBet, cfg.maxBet, 'invalid_bet');

// ------------------------------------------------------------------ dinero
function take(uuid, stake, game) {
  const p = store.db.players[uuid];
  if (p.balance < stake) throw new HttpError(402, 'insufficient_funds');
  store.adjust(uuid, -stake, 'bet:' + game);
}

function settle(uuid, game, stake, payout, extra) {
  if (payout > 0) store.adjust(uuid, payout, 'win:' + game);
  const p = store.db.players[uuid];
  p.wagered += stake;
  p.won += payout;
  store.pushHistory(uuid, { game, stake, payout, ts: Date.now() });
  store.save();
  return { balance: p.balance, stake, payout, ...extra };
}

// ------------------------------------------------------------------ operaciones con Minecraft
// Cargar fichas = retirar del servidor y acreditar acá. Retirar = debitar acá y depositar en el servidor.
// Cada operación se guarda como "pendiente" ANTES de llamar al plugin, con un txId fijo. Si la conexión
// se corta, se reintenta con el mismo txId (el plugin no duplica) hasta tener un resultado definitivo.
const inflight = new Set();
const busy = new Set();

function finalize(tx, ok) {
  store.removePending(tx.txId);
  if (tx.type === 'in' && ok) store.adjust(tx.uuid, tx.amount, 'cashin', tx.txId);
  if (tx.type === 'out' && !ok) store.adjust(tx.uuid, tx.amount, 'cashout-refund', tx.txId);
  store.save();
}

async function resolveTx(tx) {
  if (inflight.has(tx.txId)) return { state: 'retry', error: 'in_progress' };
  inflight.add(tx.txId);
  try {
    let r;
    try {
      r = tx.type === 'in'
        ? await bridge.withdraw(tx.uuid, tx.amount, tx.txId)
        : await bridge.deposit(tx.uuid, tx.amount, tx.txId);
    } catch (e) {
      events.bridgeError('unreachable', 'No hay conexión con el plugin (revisá BRIDGE_URL, el puerto y que el servidor de Minecraft esté encendido).');
      return { state: 'retry', error: 'bridge_unreachable' };
    }
    // 409 = el plugin ya procesó ese txId antes (la respuesta original se perdió): cuenta como hecho.
    if (r.status === 200 || r.status === 409) { finalize(tx, true); return { state: 'done' }; }
    if ([400, 402, 404].includes(r.status)) { finalize(tx, false); return { state: 'failed', error: (r.data && r.data.error) || 'failed' }; }
    console.error(`[puente] respuesta inesperada ${r.status} (revisá BRIDGE_KEY / el plugin)`);
    events.bridgeError('status' + r.status, `El plugin respondió ${r.status} al cargar/retirar fichas (revisá BRIDGE_KEY y la consola de Minecraft).`);
    return { state: 'retry', error: 'bridge_error' };
  } finally {
    inflight.delete(tx.txId);
  }
}

async function reconcile() {
  for (const tx of [...store.db.pending]) {
    if (Date.now() - tx.ts < 10000) continue;
    await resolveTx(tx);
  }
}

async function cash(sess, type, amount) {
  const uuid = sess.uuid;
  if (busy.has(uuid)) throw new HttpError(429, 'busy');
  busy.add(uuid);
  try {
    int(amount, 1, cfg.maxCash, 'invalid_amount');
    const tx = { txId: (type === 'in' ? 'in' : 'out') + crypto.randomBytes(16).toString('hex'), type, uuid, amount, ts: Date.now() };
    if (type === 'out') {
      if (store.db.players[uuid].balance < amount) throw new HttpError(402, 'insufficient_funds');
      store.adjust(uuid, -amount, 'cashout', tx.txId);
    }
    store.addPending(tx);
    store.save();
    const r = await resolveTx(tx);
    const balance = store.db.players[uuid].balance;
    if (r.state === 'failed') throw new HttpError(r.error === 'insufficient_funds' ? 402 : 400, type === 'in' ? 'mc_' + r.error : r.error);
    return { pending: r.state === 'retry', balance };
  } finally {
    busy.delete(uuid);
  }
}

// ------------------------------------------------------------------ rutas
const publicConfig = () => ({
  serverName: cfg.serverName, currency: cfg.currency, minBet: cfg.minBet, maxBet: cfg.maxBet, maxCash: cfg.maxCash, demo: cfg.demo,
  slots: { symbols: games.SLOT_SYMBOLS, twoCherries: games.TWO_CHERRIES },
  dice: { rtp: games.DICE_RTP },
  chicken: { levels: Object.fromEntries(Object.keys(chicken.LEVELS).map((k) => [k, { lanes: chicken.LEVELS[k].lanes, chance: chicken.view({ level: k, bet: 0, step: 0, done: false }).chance, mults: chicken.table(k) }])) },
  table: { games: match.games(), stakes: match.stakes(), rake: cfg.rake, rules: match.RULES },
});

function meView(uuid) {
  const p = store.db.players[uuid];
  const hand = store.db.hands[uuid];
  return {
    uuid, name: p.name, balance: p.balance, wagered: p.wagered, won: p.won,
    history: p.history.slice(0, 10),
    hand: hand && !hand.done ? games.bj.view(hand) : null,
    chicken: store.db.chicken[uuid] && !store.db.chicken[uuid].done ? chicken.view(store.db.chicken[uuid]) : null,
    table: match.viewFor(uuid),
  };
}

const tableOut = (uuid) => ({ table: match.viewFor(uuid) });

function bjSettle(uuid, hand) {
  const view = games.bj.view(hand);
  if (!hand.done) { store.save(); return { balance: store.db.players[uuid].balance, hand: view }; }
  delete store.db.hands[uuid];
  return settle(uuid, 'blackjack', hand.bet, hand.payout, { hand: view });
}

function chSettle(uuid, r) {
  const view = chicken.view(r);
  if (!r.done) { store.save(); return { balance: store.db.players[uuid].balance, round: view }; }
  delete store.db.chicken[uuid];
  return settle(uuid, 'chicken', r.bet, r.payout, { round: view });
}
const chActive = (uuid) => {
  const r = store.db.chicken[uuid];
  if (!r || r.done) throw new HttpError(409, 'no_active_round');
  return r;
};

const routes = {
  'GET /api/config': { auth: false, run: () => publicConfig() },

  'POST /api/auth/login': {
    auth: false,
    async run({ req, body, headers }) {
      rate('login:' + clientIp(req), 10, 60000);
      const code = String(body.code || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{6,12}$/.test(code)) throw new HttpError(400, 'invalid_code');
      let r;
      try { r = await bridge.verify(code); } catch { events.bridgeError('unreachable', 'No hay conexión con el plugin (revisá BRIDGE_URL, el puerto y que el servidor de Minecraft esté encendido).'); throw new HttpError(502, 'bridge_unreachable'); }
      if (r.status === 404) throw new HttpError(401, 'invalid_code');
      if (r.status !== 200) { events.bridgeError('status' + r.status, `El plugin respondió ${r.status} al verificar un código de /casino link (revisá BRIDGE_KEY y la consola de Minecraft).`); throw new HttpError(502, 'bridge_error'); }
      const { uuid, name } = r.data;
      store.player(uuid, name);
      store.recordLogin(uuid, name, clientIp(req), req.socket.remoteAddress);
      const token = store.createSession(uuid);
      headers['Set-Cookie'] =
        `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${cfg.sessionDays * 86400}${cfg.cookieSecure ? '; Secure' : ''}`;
      return { name };
    },
  },
  'POST /api/auth/logout': {
    auth: false,
    run({ req, headers }) {
      store.deleteSession(parseCookies(req).sid);
      headers['Set-Cookie'] = 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
      return { ok: true };
    },
  },

  // ---- panel de administración (clave propia; ver lib/admin.js)
  'POST /api/admin/login': {
    auth: false,
    run({ req, body, headers }) {
      if (!admin.enabled()) throw new HttpError(404, 'not_found');
      rate('adm:' + clientIp(req), 5, 60000);
      if (!admin.checkLogin(body.email, body.password)) throw new HttpError(401, 'unauthorized');
      headers['Set-Cookie'] = `adm=${admin.login()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${cfg.cookieSecure ? '; Secure' : ''}`;
      return { ok: true };
    },
  },
  'POST /api/admin/logout': {
    auth: false,
    run({ req, headers }) {
      admin.logout(parseCookies(req).adm);
      headers['Set-Cookie'] = 'adm=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
      return { ok: true };
    },
  },
  'GET /api/admin/events': {
    auth: false, admin: true,
    run: ({ req }) => {
      const q = new URL(req.url, 'http://x').searchParams.get('since');
      const since = q === null ? events.lastId() : Math.max(0, parseInt(q, 10) || 0);   // sin 'since': solo lo que venga de ahora en más
      return { last: events.lastId(), events: events.since(since).slice(0, 100) };
    },
  },
  'GET /api/admin/overview': { auth: false, admin: true, run: () => admin.overview() },

  'GET /api/session': { auth: false, run: ({ req }) => ({ logged: !!store.getSession(parseCookies(req).sid) }) },
  'GET /api/me': { run: ({ sess }) => meView(sess.uuid) },

  // ---- mesas (Truco y La Loba): contra bots o con matchmaking. Las novedades llegan por /api/stream (SSE).
  'GET /api/table': { run: ({ sess }) => tableOut(sess.uuid) },
  'POST /api/table/join': {
    run({ sess, body }) {
      rate('join:' + sess.uuid, 30, 60000);
      match.join(sess.uuid, store.db.players[sess.uuid].name, {
        game: body.game, mode: body.mode, stake: body.stake === undefined ? 0 : body.stake, bots: body.bots, limit: body.limit,
      });
      return tableOut(sess.uuid);
    },
  },
  'POST /api/table/act': {
    run({ sess, body }) {
      if (!body.action || typeof body.action !== 'object') throw new HttpError(400, 'invalid_action');
      match.act(sess.uuid, body.action);
      return tableOut(sess.uuid);
    },
  },
  'POST /api/table/leave': { run: ({ sess }) => { match.leave(sess.uuid); return tableOut(sess.uuid); } },

  'GET /api/cashier': {
    async run({ sess }) {
      let mc = null;
      try {
        const r = await bridge.balance(sess.uuid);
        if (r.status === 200) mc = r.data.balance;
      } catch { /* el servidor no responde */ }
      return { mcBalance: mc, balance: store.db.players[sess.uuid].balance };
    },
  },
  'POST /api/cashier/in': { run: ({ sess, body }) => cash(sess, 'in', body.amount) },
  'POST /api/cashier/out': { run: ({ sess, body }) => cash(sess, 'out', body.amount) },

  'POST /api/games/slots/spin': {
    run({ sess, body }) {
      const bet = betOf(body.bet);
      take(sess.uuid, bet, 'slots');
      const r = games.slotsSpin(bet);
      return settle(sess.uuid, 'slots', bet, r.payout, { reels: r.reels, mult: r.mult, win: r.win });
    },
  },

  'POST /api/games/roulette/spin': {
    run({ sess, body }) {
      const { bets, total } = games.validateRouletteBets(body.bets, cfg.minBet, cfg.maxBet);
      take(sess.uuid, total, 'roulette');
      const r = games.rouletteSpin(bets);
      return settle(sess.uuid, 'roulette', total, r.payout, { number: r.number, color: r.color, results: r.results });
    },
  },

  'POST /api/games/dice/roll': {
    run({ sess, body }) {
      const bet = betOf(body.bet);
      const probe = games.diceRoll; // validación del objetivo dentro de diceRoll (antes de cobrar no hay efectos)
      if (body.mode !== 'under' && body.mode !== 'over') throw new HttpError(400, 'invalid_target');
      const lo = body.mode === 'under' ? 2 : 5;
      const hi = body.mode === 'under' ? 95 : 98;
      int(body.target, lo, hi, 'invalid_target');
      take(sess.uuid, bet, 'dice');
      const r = probe(bet, body.mode, body.target);
      return settle(sess.uuid, 'dice', bet, r.payout, { roll: r.roll, win: r.win, mult: r.mult, chance: r.chance });
    },
  },

  'POST /api/games/coinflip/flip': {
    run({ sess, body }) {
      const bet = betOf(body.bet);
      if (body.side !== 'heads' && body.side !== 'tails') throw new HttpError(400, 'invalid_side');
      take(sess.uuid, bet, 'coinflip');
      const r = games.coinFlip(bet, body.side);
      return settle(sess.uuid, 'coinflip', bet, r.payout, { result: r.result, win: r.win });
    },
  },

  'POST /api/games/chicken/start': {
    run({ sess, body }) {
      const bet = betOf(body.bet);
      const uuid = sess.uuid;
      const ex = store.db.chicken[uuid];
      if (ex && !ex.done) throw new HttpError(409, 'round_in_progress');
      const r = chicken.start(bet, body.level);
      take(uuid, bet, 'chicken');
      store.db.chicken[uuid] = r;
      return chSettle(uuid, r);
    },
  },
  'POST /api/games/chicken/step': {
    run({ sess }) { const r = chActive(sess.uuid); chicken.step(r); return chSettle(sess.uuid, r); },
  },
  'POST /api/games/chicken/cashout': {
    run({ sess }) { const r = chActive(sess.uuid); chicken.cashout(r); return chSettle(sess.uuid, r); },
  },

  'POST /api/games/blackjack/deal': {
    run({ sess, body }) {
      const uuid = sess.uuid;
      const bet = betOf(body.bet);
      const existing = store.db.hands[uuid];
      if (existing && !existing.done) throw new HttpError(409, 'hand_in_progress');
      take(uuid, bet, 'blackjack');
      const hand = games.bj.deal(bet);
      store.db.hands[uuid] = hand;
      return bjSettle(uuid, hand);
    },
  },
  'POST /api/games/blackjack/hit': {
    run({ sess }) {
      const hand = store.db.hands[sess.uuid];
      if (!hand || hand.done) throw new HttpError(409, 'no_active_hand');
      games.bj.hit(hand);
      return bjSettle(sess.uuid, hand);
    },
  },
  'POST /api/games/blackjack/stand': {
    run({ sess }) {
      const hand = store.db.hands[sess.uuid];
      if (!hand || hand.done) throw new HttpError(409, 'no_active_hand');
      games.bj.stand(hand);
      return bjSettle(sess.uuid, hand);
    },
  },
  'POST /api/games/blackjack/double': {
    run({ sess }) {
      const uuid = sess.uuid;
      const hand = store.db.hands[uuid];
      if (!hand || hand.done) throw new HttpError(409, 'no_active_hand');
      if (!games.bj.canDouble(hand)) throw new HttpError(409, 'cannot_double');
      take(uuid, hand.bet, 'blackjack-double');
      games.bj.double(hand);
      return bjSettle(uuid, hand);
    },
  },
};

// ------------------------------------------------------------------ servidor HTTP
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'",
};

function sendJson(res, status, body, extra = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...extra,
  });
  res.end(data);
}

function serveStatic(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { pathname = '/'; }
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(404, SECURITY_HEADERS); res.end('Not found'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, SECURITY_HEADERS); res.end('Not found'); return; }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.svg' ? 'public, max-age=86400' : 'no-cache',
      ...SECURITY_HEADERS,
    });
    res.end(buf);
  });
}

/** Canal de eventos en tiempo real (SSE): cada cambio de la mesa del jugador llega como evento "table". */
function stream(req, res) {
  const sess = store.getSession(parseCookies(req).sid);
  if (!sess || !store.db.players[sess.uuid]) { sendJson(res, 401, { error: 'unauthorized' }); return; }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...SECURITY_HEADERS,
  });
  // El relleno de ~2 KB obliga a vaciar los búferes de proxies que retienen las primeras respuestas.
  res.write('retry: 3000\n' + ': ' + ' '.repeat(2048) + '\n\n');
  const detach = match.attach(sess.uuid, res);
  const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch { /* cerrada */ } }, 15000);
  req.on('close', () => { clearInterval(hb); detach(); });
}

async function serveAvatar(req, res, url) {
  try {
    const sess = store.getSession(parseCookies(req).sid);
    if (!sess || !store.db.players[sess.uuid]) throw new HttpError(401, 'unauthorized');
    rate('av:' + sess.uuid, 120, 60000);
    const id = decodeURIComponent(url.pathname.slice('/api/avatar/'.length));
    if (!avatar.validId(id)) throw new HttpError(400, 'bad_id');
    const buf = await avatar.get(id, url.searchParams.get('s'));
    if (!buf) throw new HttpError(404, 'not_found');
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=3600', ...SECURITY_HEADERS });
    res.end(buf);
  } catch (e) {
    if (e instanceof HttpError) sendJson(res, e.status, { error: e.code });
    else { console.error(e); sendJson(res, 500, { error: 'internal_error' }); }
  }
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SECURITY_HEADERS); res.end(); return; }
    serveStatic(req, res);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/stream') { stream(req, res); return; }
  if (req.method === 'GET' && url.pathname.startsWith('/api/avatar/')) { await serveAvatar(req, res, url); return; }
  const headers = {};
  try {
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) throw new HttpError(404, 'not_found');

    let body = {};
    if (req.method === 'POST') {
      // Exigir JSON impide que otro sitio dispare POSTs desde un formulario (junto con SameSite=Strict).
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'unsupported_media_type');
      body = await readBody(req);
      if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'bad_json');
    }

    let sess = null;
    if (route.admin && !admin.valid(parseCookies(req).adm)) throw new HttpError(admin.enabled() ? 401 : 404, admin.enabled() ? 'unauthorized' : 'not_found');
    if (route.auth !== false) {
      sess = store.getSession(parseCookies(req).sid);
      if (!sess || !store.db.players[sess.uuid]) throw new HttpError(401, 'unauthorized');
      rate('u:' + sess.uuid, 600, 60000); // tope general por jugador
    }
    const result = await route.run({ req, body, sess, headers });
    sendJson(res, 200, result, headers);
  } catch (e) {
    if (e instanceof HttpError) sendJson(res, e.status, { error: e.code }, headers);
    else if (e instanceof games.GameError) sendJson(res, 400, { error: e.code }, headers);
    else { console.error(e); sendJson(res, 500, { error: 'internal_error' }, headers); }
  }
}

function start(port = cfg.port, host = cfg.host) {
  match.recover(); // devuelve apuestas de mesas que quedaron abiertas si el servidor se reinició
  const server = http.createServer((req, res) => { handle(req, res).catch((e) => { console.error(e); res.destroy(); }); });
  const timer = setInterval(() => reconcile().catch((e) => console.error('[reconcile]', e)), 15000);
  timer.unref();
  reconcile().catch(() => {});
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

if (require.main === module) {
  if (!cfg.demo && (!cfg.bridgeKey || cfg.bridgeKey.length < 32)) {
    console.error('Falta BRIDGE_KEY en .env (la misma api-key del plugin, mínimo 32 caracteres).');
    console.error('Para probar sin Minecraft: npm run demo');
    process.exit(1);
  }
  start().then((s) => {
    console.log(`Casino en http://localhost:${s.address().port}${cfg.demo ? '  [MODO DEMO: sin servidor de Minecraft]' : ''}`);
  });
}

module.exports = { start };
