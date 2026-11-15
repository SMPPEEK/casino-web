'use strict';
/**
 * Mesas de juegos por turnos (Truco, La Loba): contra bots o contra otro jugador (matchmaking).
 *
 *  - Cada juego es un motor (lib/truco.js, lib/loba.js) con la misma interfaz; esta capa es la que
 *    maneja bots, tiempos, dinero y el envío en tiempo real (SSE).
 *  - Las apuestas se cobran al empezar la mesa y quedan "en custodia" en store.db.escrow. Si el servidor
 *    se reinicia con mesas abiertas, recover() devuelve las apuestas (las partidas no se guardan).
 *  - Ganador: modo bot paga floor(apuesta × asientos × (1 − comisión)); contra jugador, floor(pozo × (1 − comisión)).
 *    Apuesta 0 = partida de práctica sin dinero.
 */
const crypto = require('crypto');
const cfg = require('./config');
const store = require('./store');
const { GameError } = require('./games');

const ENGINES = {};
for (const g of ['truco', 'loba']) {
  try { ENGINES[g] = require('./' + g); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}

const RULES = {
  truco: { modes: ['bot', 'match'], seats: 2 },
  loba: { modes: ['bot'], minBots: 1, maxBots: 3 },
};
const BOT_NAMES = ['Pedro', 'Lucía', 'Mateo', 'Camila', 'Tomás', 'Sofía', 'Bruno', 'Valentina', 'Nacho', 'Julia'];
const QUEUE_SECONDS = 120;
const MAX_STRIKES = 3;

store.db.escrow ||= {};

const matches = new Map();   // id -> Match
const byUser = new Map();    // uuid -> Match | queue entry
const queues = new Map();    // "juego:apuesta" -> [entrada]
const hub = new Map();       // uuid -> Set<res> (conexiones SSE)

let botDelay = () => 700 + crypto.randomInt(800);
let afkScale = 1;

const rnd = (n) => crypto.randomInt(n);
const rid = () => crypto.randomBytes(8).toString('hex');
const validStake = (n) => n === 0 || (Number.isInteger(n) && n >= cfg.minBet && n <= cfg.maxBet);
const payoutOf = (stake, seats) => Math.floor(stake * seats * (1 - cfg.rake));

// ------------------------------------------------------------------ tiempo real
function sseSend(uuid, data) {
  const set = hub.get(uuid);
  if (!set) return;
  const msg = `event: table\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) { try { res.write(msg); } catch { /* conexión caída */ } }
}

function push(uuid) { sseSend(uuid, viewFor(uuid)); }

function attach(uuid, res) {
  let set = hub.get(uuid);
  if (!set) { set = new Set(); hub.set(uuid, set); }
  while (set.size >= 4) { const old = set.values().next().value; set.delete(old); try { old.end(); } catch { /* ya cerrada */ } }
  set.add(res);
  push(uuid);
  return () => { set.delete(res); if (!set.size) hub.delete(uuid); };
}

// ------------------------------------------------------------------------ mesa
class Match {
  constructor({ game, mode, stake, humans, names, bots, options }) {
    this.id = rid();
    this.game = game;
    this.mode = mode;
    this.stake = stake;
    this.engine = ENGINES[game];
    this.humans = humans;                       // uuid por asiento, null = bot
    this.names = names;
    this.bots = bots;
    this.status = 'playing';
    this.strikes = names.map(() => 0);
    this.result = null;
    this.deadline = null;
    this.timer = null;
    this.rev = 0; // número de versión: el cliente descarta vistas viejas que lleguen tarde
    this.state = this.engine.create({ names, bots, options });
    matches.set(this.id, this);
    for (const u of humans) if (u) byUser.set(u, this);
  }

  seatOf(uuid) { return this.humans.indexOf(uuid); }

  view(uuid) {
    const seat = this.seatOf(uuid);
    return {
      id: this.id, rev: this.rev, game: this.game, mode: this.mode, stake: this.stake, status: this.status, seat,
      players: this.names.map((name, i) => ({ name, bot: this.bots[i], you: i === seat })),
      state: this.engine.view(this.state, seat),
      deadline: this.deadline, serverTime: Date.now(),
      result: this.result,
      balance: store.db.players[uuid].balance,
    };
  }

  pushAll() { for (const u of this.humans) if (u) push(u); }

  act(uuid, action) {
    if (this.status !== 'playing') throw new GameError('table_over');
    const seat = this.seatOf(uuid);
    if (seat < 0) throw new GameError('not_at_table');
    this.engine.act(this.state, seat, action);
    this.strikes[seat] = 0;
    this.afterAct();
  }

  afterAct() {
    clearTimeout(this.timer);
    this.deadline = null;
    this.rev++;
    if (this.engine.isOver(this.state)) { this.finish(this.engine.winner(this.state)); return; }
    const actors = this.engine.actors(this.state);
    const botSeat = actors.find((s) => this.bots[s]);
    if (botSeat !== undefined) {
      this.timer = setTimeout(() => this.botStep(botSeat), botDelay());
      this.timer.unref();
    } else if (actors.length) {
      const ms = Math.round(this.engine.turnSeconds(this.state) * 1000 * afkScale);
      this.deadline = Date.now() + ms;
      this.timer = setTimeout(() => this.afk(actors), ms);
      this.timer.unref();
    }
    this.pushAll();
  }

  botStep(seat) {
    if (this.status !== 'playing') return;
    try {
      this.engine.act(this.state, seat, this.engine.botAction(this.state, seat));
    } catch (e) {
      console.error(`[mesa ${this.game}] el bot falló:`, e);
      try { this.engine.act(this.state, seat, this.engine.autoAction(this.state, seat)); } catch { this.abort(); return; }
    }
    this.afterAct();
  }

  /** El jugador no respondió a tiempo: se juega por él; con 3 demoras seguidas pierde la partida. */
  afk(actors) {
    if (this.status !== 'playing') return;
    for (const seat of actors) {
      if (this.humans[seat] === null) continue;
      const wasReady = this.engine.autoAction(this.state, seat).type === 'ready';
      if (!wasReady && ++this.strikes[seat] >= MAX_STRIKES) { this.forfeit(seat); return; }
      try { this.engine.act(this.state, seat, this.engine.autoAction(this.state, seat)); } catch { /* otro actor ya movió */ }
      break;
    }
    this.afterAct();
  }

  forfeit(seat) {
    const others = this.names.map((_, i) => i).filter((i) => i !== seat);
    const winner = this.mode === 'match' ? others[0] : (others.find((i) => this.bots[i]) ?? others[0]);
    this.finish(winner, 'forfeit');
  }

  leave(uuid) {
    if (this.status === 'playing') { this.forfeit(this.seatOf(uuid)); return; }
    byUser.delete(uuid);
  }

  /** Error interno irrecuperable: se devuelven las apuestas. */
  abort() {
    if (this.status === 'over') return;
    this.status = 'over';
    this.rev++;
    clearTimeout(this.timer);
    for (const u of this.humans) if (u && this.stake > 0) store.adjust(u, this.stake, 'refund:' + this.game, this.id);
    delete store.db.escrow[this.id];
    store.save();
    this.result = { winnerSeat: null, payouts: this.names.map(() => 0), aborted: true };
    this.finishCleanup();
  }

  finish(winnerSeat, reason) {
    if (this.status === 'over') return;
    this.status = 'over';
    clearTimeout(this.timer);
    this.deadline = null;
    this.rev++;
    const seats = this.names.length;
    const payouts = this.names.map(() => 0);
    if (this.stake > 0 && winnerSeat !== null && this.humans[winnerSeat]) {
      payouts[winnerSeat] = this.mode === 'match' ? payoutOf(this.stake, 2) : payoutOf(this.stake, seats);
    }
    for (const [i, u] of this.humans.entries()) {
      if (!u || this.stake === 0) continue;
      if (payouts[i] > 0) store.adjust(u, payouts[i], 'win:' + this.game, this.id);
      const p = store.db.players[u];
      p.wagered += this.stake;
      p.won += payouts[i];
      store.pushHistory(u, { game: this.game, stake: this.stake, payout: payouts[i], ts: Date.now() });
    }
    delete store.db.escrow[this.id];
    store.save();
    this.result = { winnerSeat, payouts, reason: reason || 'normal' };
    this.finishCleanup();
  }

  finishCleanup() {
    this.pushAll();
    const t = setTimeout(() => { matches.delete(this.id); for (const u of this.humans) if (u && byUser.get(u) === this) byUser.delete(u); }, 30 * 60000);
    t.unref();
  }
}

// ------------------------------------------------------------------ API pública
function startMatch({ game, mode, stake, humans, names, bots, options }) {
  const needed = humans.filter(Boolean);
  if (stake > 0) {
    for (const u of needed) if (store.db.players[u].balance < stake) throw new GameError('insufficient_funds');
    for (const u of needed) store.adjust(u, -stake, 'bet:' + game);
  }
  let m;
  try {
    m = new Match({ game, mode, stake, humans, names, bots, options });
  } catch (e) { // si el motor falla al crear la partida, nadie pierde plata
    if (stake > 0) for (const u of needed) store.adjust(u, stake, 'refund:' + game);
    throw e;
  }
  if (stake > 0) {
    store.db.escrow[m.id] = { game, stake, uuids: needed };
    store.save();
  }
  m.afterAct();
  return m;
}

function pickBots(n, avoid) {
  const pool = BOT_NAMES.filter((x) => !avoid.includes(x));
  const out = [];
  while (out.length < n) out.push('Bot ' + pool.splice(rnd(pool.length), 1)[0]);
  return out;
}

function viewFor(uuid) {
  const e = byUser.get(uuid);
  if (!e) return null;
  if (e.status === 'queue') {
    return { id: e.id, game: e.game, mode: 'match', stake: e.stake, status: 'queue', since: e.since, queueSeconds: QUEUE_SECONDS, serverTime: Date.now(), balance: store.db.players[uuid].balance };
  }
  return e.view(uuid);
}

function dropQueueEntry(e) {
  clearTimeout(e.timer);
  const key = `${e.game}:${e.stake}`;
  const list = (queues.get(key) || []).filter((x) => x !== e);
  if (list.length) queues.set(key, list); else queues.delete(key);
  if (byUser.get(e.uuid) === e) byUser.delete(e.uuid);
}

function join(uuid, name, opts) {
  const { game, mode } = opts;
  const rules = RULES[game];
  if (!rules || !ENGINES[game]) throw new GameError('invalid_game');
  if (!rules.modes.includes(mode)) throw new GameError('invalid_mode');
  const stake = opts.stake ?? 0;
  if (!validStake(stake)) throw new GameError('invalid_stake');

  const cur = byUser.get(uuid);
  if (cur && cur.status === 'over') byUser.delete(uuid);
  else if (cur) throw new GameError('already_playing');
  if (stake > 0 && store.db.players[uuid].balance < stake) throw new GameError('insufficient_funds');

  if (mode === 'bot') {
    let nBots = 1;
    const options = {};
    if (game === 'loba') {
      nBots = Number.isInteger(opts.bots) ? opts.bots : 2;
      if (nBots < rules.minBots || nBots > rules.maxBots) throw new GameError('invalid_options');
      options.limit = opts.limit === 50 ? 50 : 100;
    }
    const botNames = pickBots(nBots, [name]);
    return startMatch({
      game, mode, stake, humans: [uuid, ...botNames.map(() => null)], names: [name, ...botNames],
      bots: [false, ...botNames.map(() => true)], options,
    });
  }

  // matchmaking: misma apuesta, juego distinto de uno mismo
  const key = `${game}:${stake}`;
  const list = queues.get(key) || [];
  const rival = list.find((x) => x.uuid !== uuid && store.db.players[x.uuid] && (stake === 0 || store.db.players[x.uuid].balance >= stake));
  for (const x of list.filter((y) => y !== rival && stake > 0 && store.db.players[y.uuid].balance < stake)) dropQueueEntry(x);
  if (rival) {
    dropQueueEntry(rival);
    const flip = rnd(2) === 0;
    const a = flip ? uuid : rival.uuid;
    const b = flip ? rival.uuid : uuid;
    return startMatch({
      game, mode, stake, humans: [a, b], names: [store.db.players[a].name, store.db.players[b].name], bots: [false, false], options: {},
    });
  }
  const entry = { id: rid(), game, stake, uuid, status: 'queue', since: Date.now() };
  entry.timer = setTimeout(() => {
    dropQueueEntry(entry);
    sseSend(uuid, { id: entry.id, game, stake, status: 'cancelled', reason: 'timeout', balance: store.db.players[uuid].balance });
  }, QUEUE_SECONDS * 1000 * afkScale);
  entry.timer.unref();
  queues.set(key, [...list, entry]);
  byUser.set(uuid, entry);
  return entry;
}

function find(uuid) {
  const e = byUser.get(uuid);
  if (!e || e.status === 'queue') throw new GameError('no_table');
  return e;
}

const act = (uuid, action) => { find(uuid).act(uuid, action); };
const leave = (uuid) => {
  const e = byUser.get(uuid);
  if (!e) return;
  if (e.status === 'queue') { dropQueueEntry(e); return; }
  e.leave(uuid);
};

/** Al arrancar: las partidas no sobreviven a un reinicio, así que se devuelven las apuestas en custodia. */
function recover() {
  const esc = store.db.escrow;
  for (const [id, e] of Object.entries(esc)) {
    for (const u of e.uuids) if (store.db.players[u]) store.adjust(u, e.stake, 'refund:' + e.game, id);
    delete esc[id];
  }
  store.save();
}

module.exports = {
  RULES, attach, join, act, leave, viewFor, recover,
  stakes: () => [10, 50, 100, 500, 1000, 5000].filter((s) => s >= cfg.minBet && s <= cfg.maxBet),
  games: () => Object.keys(ENGINES),
  // sólo para tests
  _testing: { setBotDelay(fn) { botDelay = fn; }, setAfkScale(n) { afkScale = n; }, matches, byUser, queues },
};
