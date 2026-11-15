'use strict';
// Panel de administración: acceso con correo y contraseña propios (ADMIN_EMAIL, ADMIN_PASSWORD), independiente de las cuentas de Minecraft,
// porque en servidores no premium cualquiera puede usar el nombre de otro jugador.
const crypto = require('crypto');
const cfg = require('./config');
const store = require('./store');

const TTL = 12 * 3600 * 1000;
const sessions = new Map(); // hash(token) -> expira
const sha = (t) => crypto.createHash('sha256').update(t).digest();
const hex = (t) => sha(t).toString('hex');

function enabled() { return cfg.adminPassword.length >= 12; }

const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

/** Correo (si está configurado ADMIN_EMAIL) y contraseña; se comparan siempre los dos para no dar pistas por el tiempo. */
function checkLogin(email, password) {
  if (!enabled() || typeof password !== 'string') return false;
  const emailOk = !cfg.adminEmail || (typeof email === 'string' && same(email.trim().toLowerCase(), cfg.adminEmail));
  const passOk = same(password, cfg.adminPassword);
  return emailOk && passOk;
}
function login() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(hex(token), Date.now() + TTL);
  return token;
}
function valid(token) {
  if (!enabled() || !token) return false;
  const k = hex(token);
  const exp = sessions.get(k);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(k); return false; }
  return true;
}
function logout(token) { if (token) sessions.delete(hex(token)); }

/** Resumen por juego, jugadores, ingresos y jugadas recientes. net > 0: el jugador ganó; < 0: perdió. */
function overview() {
  const perGame = {};
  const players = Object.entries(store.db.players).map(([uuid, p]) => {
    let wagered = 0; let paid = 0; let rounds = 0;
    const games = {};
    for (const [g, s] of Object.entries(p.stats || {})) {
      games[g] = { rounds: s.rounds, wagered: s.wagered, paid: s.paid, net: s.paid - s.wagered };
      wagered += s.wagered; paid += s.paid; rounds += s.rounds;
      const a = perGame[g] = perGame[g] || { rounds: 0, wagered: 0, paid: 0 };
      a.rounds += s.rounds; a.wagered += s.wagered; a.paid += s.paid;
    }
    return {
      uuid, name: p.name, balance: p.balance, created: p.created, lastLogin: p.lastLogin || null, logins: p.logins || 0,
      ips: (p.ips || []).map((x) => ({ ip: x.ip, first: x.first, last: x.last, n: x.n })),
      rounds, wagered, paid, net: paid - wagered, games,
    };
  }).sort((a, b) => (b.lastLogin || 0) - (a.lastLogin || 0));
  const games = Object.entries(perGame).map(([game, a]) => ({ game, ...a, house: a.wagered - a.paid }))
    .sort((a, b) => b.rounds - a.rounds);
  const total = games.reduce((t, g) => ({ rounds: t.rounds + g.rounds, wagered: t.wagered + g.wagered, paid: t.paid + g.paid }), { rounds: 0, wagered: 0, paid: 0 });
  return {
    now: Date.now(), currency: cfg.currency, demo: cfg.demo,
    total: { ...total, house: total.wagered - total.paid, players: players.length },
    games, players,
    logins: store.db.loginLog.slice(0, 200),
    recent: store.db.recent.slice(0, 100),
  };
}

module.exports = { enabled, checkLogin, emailRequired: () => !!cfg.adminEmail, login, valid, logout, overview };
