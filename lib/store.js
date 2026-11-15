'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config');
const events = require('./events');

fs.mkdirSync(cfg.dataDir, { recursive: true });
const FILE = path.join(cfg.dataDir, 'store.json');
const LEDGER = path.join(cfg.dataDir, 'ledger.log');

const db = { players: {}, sessions: {}, hands: {}, chicken: {}, pending: [], loginLog: [], recent: [] };
try { Object.assign(db, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch { /* primera vez */ }
db.loginLog = db.loginLog || [];
db.recent = db.recent || [];
db.chicken = db.chicken || {};

/** Escritura atómica: archivo temporal + rename, para no corromper el saldo si se corta la luz. */
function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

function player(uuid, name) {
  let p = db.players[uuid];
  if (!p) {
    p = db.players[uuid] = { name: name || 'Jugador', balance: 0, wagered: 0, won: 0, history: [], created: Date.now() };
  }
  if (name && p.name !== name) p.name = name;
  return p;
}

/** Todo cambio de saldo pasa por acá y queda en ledger.log (auditoría). */
function adjust(uuid, delta, type, ref = '') {
  const p = db.players[uuid];
  if (!p) throw new Error('unknown_player');
  if (!Number.isSafeInteger(delta)) throw new Error('bad_delta');
  if (p.balance + delta < 0) throw new Error('insufficient');
  p.balance += delta;
  fs.appendFileSync(LEDGER, `${new Date().toISOString()},${uuid},${type},${delta},${p.balance},${ref}\n`);
  return p.balance;
}

function pushHistory(uuid, entry) {
  const p = db.players[uuid];
  p.history.unshift(entry);
  if (p.history.length > 20) p.history.length = 20;
  // Estadísticas por juego (para el panel de administración).
  p.stats = p.stats || {};
  const g = p.stats[entry.game] = p.stats[entry.game] || { rounds: 0, wagered: 0, paid: 0 };
  g.rounds += 1; g.wagered += entry.stake; g.paid += entry.payout;
  db.recent.unshift({ t: entry.ts, uuid, name: p.name, game: entry.game, stake: entry.stake, payout: entry.payout });
  if (db.recent.length > 300) db.recent.length = 300;
  if (Math.abs(entry.payout - entry.stake) >= 100) events.emit('round', { name: p.name, game: entry.game, stake: entry.stake, payout: entry.payout, net: entry.payout - entry.stake });
}

/** Registro de ingresos (IP y nombre) para el administrador. Se conservan los últimos 500 y 10 IP por jugador. */
function recordLogin(uuid, name, ip, sock) {
  const p = db.players[uuid];
  const now = Date.now();
  p.logins = (p.logins || 0) + 1;
  p.lastLogin = now;
  p.ips = p.ips || [];
  let e = p.ips.find((x) => x.ip === ip);
  if (!e) { e = { ip, first: now, last: now, n: 0 }; p.ips.unshift(e); if (p.ips.length > 10) p.ips.length = 10; }
  e.last = now; e.n += 1;
  db.loginLog.unshift({ t: now, uuid, name, ip, sock: sock && sock !== ip ? sock : undefined });
  events.emit('login', { name, ip });
  if (db.loginLog.length > 500) db.loginLog.length = 500;
}

// ---- sesiones (se guarda solo el hash del token)
function createSession(uuid) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[sha(token)] = { uuid, created: Date.now() };
  save();
  return token;
}
function getSession(token) {
  if (!token) return null;
  const key = sha(token);
  const s = db.sessions[key];
  if (!s) return null;
  if (Date.now() - s.created > cfg.sessionDays * 86400000) { delete db.sessions[key]; save(); return null; }
  return s;
}
function deleteSession(token) {
  if (token) { delete db.sessions[sha(token)]; save(); }
}

// ---- operaciones pendientes con el servidor de Minecraft
function addPending(tx) { db.pending.push(tx); }
function removePending(txId) { db.pending = db.pending.filter((t) => t.txId !== txId); }

module.exports = { db, save, player, adjust, pushHistory, recordLogin, createSession, getSession, deleteSession, addPending, removePending };
