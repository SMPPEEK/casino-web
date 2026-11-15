import { h, fmt, toast, $ } from './ui.js';
import * as sfx from './sfx.js';
import slots from './games/slots.js';
import roulette from './games/roulette.js';
import blackjack from './games/blackjack.js';
import dice from './games/dice.js';
import coinflip from './games/coinflip.js';
import chicken from './games/chicken.js';
import truco from './games/truco.js';
import loba from './games/loba.js';
import { createTable } from './table.js';

const GAMES = [slots, roulette, blackjack, dice, coinflip, chicken, truco, loba];
const ERR = {
  unauthorized: 'Tu sesión venció. Entrá de nuevo.',
  insufficient_funds: 'No tenés fichas suficientes.',
  invalid_bet: 'Apuesta inválida.',
  invalid_bets: 'Revisá tus apuestas.',
  invalid_amount: 'Monto inválido.',
  invalid_code: 'Código inválido o vencido. Generá uno nuevo con /casino link.',
  invalid_target: 'Objetivo inválido.',
  hand_in_progress: 'Ya tenés una mano en juego.',
  no_active_hand: 'No hay una mano activa.',
  round_in_progress: 'Ya tenés una ronda en juego.',
  no_active_round: 'No hay una ronda activa.',
  no_steps: 'Avanzá al menos un carril antes de cobrar.',
  round_over: 'La ronda ya terminó.',
  invalid_level: 'Dificultad inválida.',
  cannot_double: 'Ya no podés doblar.',
  rate_limited: 'Demasiado rápido, esperá un momento.',
  busy: 'Hay otra operación en curso.',
  bridge_unreachable: 'No se pudo contactar con el servidor de Minecraft.',
  bridge_error: 'Error al comunicarse con el servidor de Minecraft.',
  mc_insufficient_funds: 'No tenés tanto dinero en el servidor de Minecraft.',
  mc_unknown_player: 'El servidor no reconoce a tu jugador.',
  unknown_player: 'El servidor no reconoce a tu jugador.',
  // mesas (Truco y La Loba)
  not_your_turn: 'Todavía no es tu turno.',
  illegal_card: 'Esa carta no se puede jugar.',
  illegal_call: 'Ese canto no está permitido ahora.',
  illegal_answer: 'Respuesta inválida.',
  illegal_fold: 'No podés irte al mazo ahora.',
  invalid_action: 'Acción inválida.',
  game_over: 'La partida ya terminó.',
  hand_over: 'La mano ya terminó.',
  already_playing: 'Ya tenés una partida en curso.',
  invalid_game: 'Juego inválido.',
  invalid_mode: 'Modo de juego inválido.',
  invalid_stake: 'Apuesta inválida.',
  invalid_options: 'Opciones inválidas.',
  no_table: 'No tenés una mesa abierta.',
  table_over: 'La mesa ya terminó.',
  not_at_table: 'No estás en esa mesa.',
  must_play_discard: 'Primero tenés que usar la carta que tomaste del pozo.',
  discard_unusable: 'Esa carta del pozo no se puede usar ahora.',
  invalid_meld: 'Esa combinación no es válida.',
  cannot_add: 'No se puede agregar esa carta ahí.',
  need_meld_first: 'Primero tenés que bajar una combinación propia.',
  wrong_phase: 'Esa acción no se puede hacer ahora.',
  joker_discard: 'El comodín solo se puede descartar si es tu última carta.',
};

const state = { config: null, me: null, cleanup: null, shown: 0 };
let table = null;
const el = (id) => document.getElementById(id);

// ------------------------------------------------------------------ API
async function api(path, body) {
  const hasBody = body !== undefined;
  const res = await fetch('/api' + path, {
    method: hasBody ? 'POST' : 'GET',
    headers: hasBody ? { 'Content-Type': 'application/json' } : {},
    body: hasBody ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') showLogin();
    const err = new Error(data.error || 'error');
    err.code = data.error || 'error';
    err.status = res.status;
    throw err;
  }
  return data;
}
const errMsg = (e) => ERR[e.code] || 'Ocurrió un error. Probá de nuevo.';

// ------------------------------------------------------------------ saldo
function setBalance(n) {
  if (!state.me) return;
  state.me.balance = n;
  const node = el('balance');
  const from = state.shown;
  const t0 = performance.now();
  const dur = Math.min(700, 150 + Math.abs(n - from) / 4);
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    state.shown = Math.round(from + (n - from) * (1 - Math.pow(1 - k, 3)));
    node.textContent = fmt(state.shown);
    if (k < 1 && state.me.balance === n) requestAnimationFrame(step);
    else { state.shown = n; node.textContent = fmt(n); }
  };
  requestAnimationFrame(step);
}

async function refreshMe() {
  // evita pedir /me sin sesión (daba un 401 en la consola en cada carga)
  if (!(await api('/session')).logged) { const e = new Error('unauthorized'); e.code = 'unauthorized'; throw e; }
  state.me = await api('/me');
  state.shown = state.me.balance;
  el('balance').textContent = fmt(state.me.balance);
  el('player-name').textContent = state.me.name;
  const av = el('avatar');
  av.onerror = () => { av.onerror = null; av.src = '/assets/avatar.svg'; };   // sin red: cabeza genérica propia
  av.src = '/api/avatar/' + encodeURIComponent(state.me.uuid) + '?s=64';
  av.hidden = false;
  el('account').hidden = false;
}

// ------------------------------------------------------------------ navegación
function renderNav() {
  const nav = el('nav');
  nav.replaceChildren(
    h('a', { href: '#/', 'data-r': '' }, 'Inicio'),
    ...GAMES.map((g) => h('a', { href: '#/' + g.id, 'data-r': g.id }, g.title)));
}

function currentRoute() { return location.hash.replace(/^#\/?/, '') || ''; }

function route() {
  if (state.cleanup) { try { state.cleanup(); } catch { /* ignorar */ } state.cleanup = null; }
  const r = currentRoute();
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.r === r));
  const stage = el('stage');
  stage.replaceChildren();
  if (!state.me) return;
  const game = GAMES.find((g) => g.id === r);
  if (!game) { renderLobby(stage); return; }
  const wrap = h('section', { class: 'game game-' + game.id });
  stage.append(wrap);
  state.cleanup = game.mount(wrap, ctx) || null;
}

const ctx = {
  api, state, setBalance, toast, sfx, errMsg, refreshMe,
  get table() { return table; },
  get config() { return state.config; },
  balance: () => (state.me ? state.me.balance : 0),
};

function renderLobby(stage) {
  const cur = state.config.currency;
  const names = { slots: 'Tragamonedas', roulette: 'Ruleta', blackjack: 'Blackjack', dice: 'Dados', coinflip: 'Cara o cruz', chicken: 'Chicken Road', truco: 'Truco', loba: 'La Loba' };
  const gameNames = { ...names };
  const hist = state.me.history;
  stage.append(
    h('section', { class: 'lobby' },
      h('div', { class: 'hero' },
        h('h1', {}, 'Bienvenido, ', h('span', { class: 'gold' }, state.me.name)),
        h('p', {}, `Jugá con tus ${cur} del servidor ${state.config.serverName}. Cargá fichas en el cajero y retirá cuando quieras.`),
        h('button', { class: 'btn primary', type: 'button', onclick: openCashier }, 'Abrir cajero')),
      h('aside', { class: 'panel legal-box', role: 'note' },
        h('h3', {}, 'Aviso importante'),
        h('p', {}, 'Esto es un juego de entretenimiento dentro del servidor de Minecraft. Las fichas son moneda virtual del juego: ',
          h('b', {}, 'no tienen valor monetario'), ', ', h('b', {}, 'no se compran con dinero real'), ' y ', h('b', {}, 'no se pueden canjear ni vender por dinero, premios o bienes'),
          '. Está prohibido intercambiarlas por dinero fuera del servidor. Si alguien te ofrece comprar o vender fichas, avisale al administrador. Recomendado para mayores de 18 años; jugá con moderación. ',
          h('a', { href: '/legal.html' }, 'Términos y aviso legal'))),
      h('div', { class: 'game-grid' },
        ...GAMES.map((g) => h('a', { class: 'game-card', href: '#/' + g.id },
          h('img', { src: '/assets/' + g.icon, alt: '', width: 84, height: 84 }),
          h('h3', {}, g.title),
          h('p', {}, g.blurb)))),
      h('div', { class: 'lobby-cols' },
        h('div', { class: 'panel' },
          h('h3', {}, 'Tus números'),
          h('dl', { class: 'stats' },
            h('div', {}, h('dt', {}, 'Apostado'), h('dd', {}, fmt(state.me.wagered))),
            h('div', {}, h('dt', {}, 'Ganado'), h('dd', {}, fmt(state.me.won))),
            h('div', {}, h('dt', {}, 'Balance'), h('dd', { class: state.me.won - state.me.wagered >= 0 ? 'pos' : 'neg' },
              (state.me.won - state.me.wagered >= 0 ? '+' : '') + fmt(state.me.won - state.me.wagered))))),
        h('div', { class: 'panel' },
          h('h3', {}, 'Últimas jugadas'),
          hist.length
            ? h('ul', { class: 'history' }, ...hist.map((x) => {
              const net = x.payout - x.stake;
              return h('li', {},
                h('span', {}, gameNames[x.game] || x.game),
                h('span', { class: net > 0 ? 'pos' : net < 0 ? 'neg' : '' }, (net > 0 ? '+' : '') + fmt(net)));
            }))
            : h('p', { class: 'hint' }, 'Todavía no jugaste. ¡Elegí un juego!')))));
}

// ------------------------------------------------------------------ login
function showLogin() {
  state.me = null;
  if (table) table.disconnect();
  el('account').hidden = true;
  const dlg = el('login-dialog');
  if (!dlg.open) dlg.showModal();
  setTimeout(() => el('login-code').focus(), 50);
}

function initLogin() {
  const dlg = el('login-dialog');
  dlg.addEventListener('cancel', (e) => e.preventDefault()); // no se puede cerrar sin entrar
  el('login-demo').hidden = !state.config.demo;
  el('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = el('login-error');
    err.textContent = '';
    try {
      await api('/auth/login', { code: el('login-code').value });
      el('login-code').value = '';
      await refreshMe();
      table.connect();
      dlg.close();
      sfx.win();
      route();
    } catch (ex) { err.textContent = errMsg(ex); }
  });
  el('logout-btn').addEventListener('click', async () => {
    try { await api('/auth/logout', {}); } catch { /* ignorar */ }
    showLogin();
    route();
  });
}

// ------------------------------------------------------------------ cajero
let cashierTab = 'in';
async function openCashier() {
  if (!state.me) return;
  el('cashier-msg').textContent = '';
  el('cashier-amount').value = '';
  setCashierTab(cashierTab);
  el('cashier-dialog').showModal();
  try {
    const info = await api('/cashier');
    state.mc = info.mcBalance;
  } catch { state.mc = null; }
  setCashierTab(cashierTab);
}

function setCashierTab(tab) {
  cashierTab = tab;
  document.querySelectorAll('#cashier-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const cur = state.config.currency;
  const mc = state.mc == null ? '—' : fmt(state.mc);
  $('#cashier-info').textContent = tab === 'in'
    ? `Tu dinero en el servidor: ${mc} ${cur}. Se descuenta de ahí y se convierte en fichas 1 a 1.`
    : `Tus fichas: ${fmt(state.me.balance)}. Se envían a tu cuenta del servidor 1 a 1.`;
  const q = el('cashier-quick');
  const amounts = [100, 1000, 10000];
  q.replaceChildren(
    ...amounts.map((n) => h('button', { type: 'button', class: 'chip-btn', onclick: () => { el('cashier-amount').value = n; } }, fmt(n))),
    h('button', { type: 'button', class: 'chip-btn', onclick: () => {
      const all = tab === 'in' ? (state.mc == null ? 0 : Math.floor(state.mc)) : state.me.balance;
      el('cashier-amount').value = Math.max(0, Math.min(all, state.config.maxCash));
    } }, 'Todo'));
}

function initCashier() {
  el('balance-btn').addEventListener('click', openCashier);
  el('cashier-close').addEventListener('click', () => el('cashier-dialog').close());
  document.querySelectorAll('#cashier-tabs button').forEach((b) => b.addEventListener('click', () => setCashierTab(b.dataset.tab)));
  el('cashier-go').addEventListener('click', async () => {
    const msg = el('cashier-msg');
    msg.textContent = '';
    const amount = Math.floor(Number(el('cashier-amount').value));
    if (!Number.isInteger(amount) || amount < 1) { msg.textContent = ERR.invalid_amount; return; }
    const btn = el('cashier-go');
    btn.disabled = true;
    try {
      const r = await api('/cashier/' + cashierTab, { amount });
      setBalance(r.balance);
      if (r.pending) toast('Operación en proceso: se confirmará en unos segundos.', 'info');
      else { toast(cashierTab === 'in' ? 'Fichas cargadas' : 'Retiro enviado al servidor', 'win'); sfx.win(); }
      el('cashier-dialog').close();
      if (currentRoute() === '') route();
    } catch (ex) { msg.textContent = errMsg(ex); }
    finally { btn.disabled = false; }
  });
}

// ------------------------------------------------------------------ arranque
async function init() {
  state.config = await fetch('/api/config').then((r) => r.json());
  document.title = state.config.serverName + ' · Casino';
  el('brand-name').textContent = state.config.serverName;
  el('cur-label').textContent = 'fichas';
  el('demo-banner').hidden = !state.config.demo;

  table = createTable(api, (b) => setBalance(b));
  renderNav();
  table.onUpdate((v) => {
    const live = v && (v.status === 'playing' || v.status === 'queue') ? v.game : null;
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('live', !!live && a.dataset.r === live));
  });
  initLogin();
  initCashier();

  const mute = el('mute-btn');
  mute.textContent = sfx.isMuted() ? '🔇' : '🔊';
  mute.addEventListener('click', () => { mute.textContent = sfx.toggleMute() ? '🔇' : '🔊'; sfx.click(); });

  window.addEventListener('hashchange', route);
  try { await refreshMe(); table.connect(); route(); } catch { showLogin(); }
}

init();
