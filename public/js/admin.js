import { h } from './ui.js';

const root = document.getElementById('root');
const GAME = { slots: 'Tragamonedas', roulette: 'Ruleta', blackjack: 'Blackjack', dice: 'Dados', coinflip: 'Cara o cruz', chicken: 'Chicken Road', truco: 'Truco', loba: 'La Loba' };
const gname = (g) => GAME[g] || g;
const nf = new Intl.NumberFormat('es-AR');
const num = (n) => nf.format(n);
const when = (t) => (t ? new Date(t).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const signed = (n) => (n > 0 ? '+' : '') + num(n);
const cls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');

async function api(path, body) {
  const res = await fetch('/api/admin' + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let data = {};
  try { data = await res.json(); } catch { /* vacío */ }
  if (!res.ok) { const e = new Error(data.error || 'error'); e.status = res.status; throw e; }
  return data;
}

// ------------------------------------------------------------------ avisos (ventanitas que desaparecen solas)
const DEFAULTS = { login: true, win: true, loss: true, bridge: true, sound: false, winMin: 5000, lossMin: 5000 };
let prefs = { ...DEFAULTS };
try { prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('adm-prefs') || '{}') }; } catch { /* sin almacenamiento */ }
const savePrefs = () => { try { localStorage.setItem('adm-prefs', JSON.stringify(prefs)); } catch { /* ignorar */ } };
let lastEvt = null;
let evtTimer = null;
let audio = null;

function beep(kind) {
  if (!prefs.sound) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(); const g = audio.createGain();
    o.type = 'square'; o.frequency.value = kind === 'bridge' ? 220 : kind === 'loss' ? 330 : 660;
    g.gain.value = 0.04; o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + 0.18);
  } catch { /* sin audio */ }
}

function toast(kind, tag, text, ms = 9000) {
  let box = document.getElementById('adm-toasts');
  if (!box) { box = h('div', { id: 'adm-toasts', class: 'adm-toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const el = h('div', { class: 'adm-toast ' + kind }, h('b', {}, tag), h('span', {}, text),
    h('button', { type: 'button', class: 'adm-toast-x', 'aria-label': 'Cerrar', onclick: () => el.remove() }, '×'));
  box.prepend(el);
  while (box.children.length > 5) box.lastChild.remove();
  setTimeout(() => el.remove(), ms);
  beep(kind);
}

function showEvent(e) {
  if (e.type === 'login' && prefs.login) toast('login', 'INGRESO', `${e.name} entró · IP ${e.ip}`);
  else if (e.type === 'round') {
    if (e.net >= prefs.winMin && prefs.win) toast('win', 'GANÓ', `${e.name} ganó ${num(e.net)} en ${gname(e.game)} (apostó ${num(e.stake)})`);
    else if (-e.net >= prefs.lossMin && prefs.loss) toast('loss', 'PERDIÓ', `${e.name} perdió ${num(-e.net)} en ${gname(e.game)}`);
  } else if (e.type === 'bridge' && prefs.bridge) toast('bridge', 'ALERTA', e.detail || 'Falla de conexión con Minecraft', 20000);
}

async function pollEvents() {
  try {
    const r = await api(lastEvt === null ? '/events' : '/events?since=' + lastEvt);
    if (lastEvt !== null) r.events.forEach(showEvent);
    lastEvt = r.last;
  } catch (e) { if (e.status === 401) { stopEvents(); loginView(); } }
}
function startEvents() { stopEvents(); lastEvt = null; pollEvents(); evtTimer = setInterval(pollEvents, 4000); }
function stopEvents() { clearInterval(evtTimer); evtTimer = null; lastEvt = null; }

function prefsView() {
  const chk = (key, label) => h('label', { class: 'adm-pref' }, h('input', { type: 'checkbox', checked: prefs[key], onchange: (e) => { prefs[key] = e.target.checked; savePrefs(); if (key === 'sound' && prefs.sound) beep('login'); } }), ' ' + label);
  const numIn = (key, label) => h('label', { class: 'adm-pref' }, label + ' ', h('input', { type: 'number', min: 100, step: 100, value: prefs[key], class: 'bet-input adm-num', onchange: (e) => {
    prefs[key] = Math.max(100, parseInt(e.target.value, 10) || DEFAULTS[key]); e.target.value = prefs[key]; savePrefs(); } }));
  return h('details', { class: 'panel adm-section' }, h('summary', {}, 'Avisos en pantalla'),
    h('div', { class: 'adm-prefs' }, chk('login', 'Cuando alguien ingresa'), chk('win', 'Cuando alguien gana mucho'), numIn('winMin', '    ganancia desde'),
      chk('loss', 'Cuando alguien pierde mucho'), numIn('lossMin', '    pérdida desde'), chk('bridge', 'Cuando falla la conexión con Minecraft'), chk('sound', 'Sonido')),
    h('p', { class: 'adm-note' }, 'Los avisos salen mientras tengas esta página abierta. Montos mínimos: 100 (las jugadas menores no se registran como aviso).'),
    h('button', { class: 'btn small', type: 'button', onclick: () => toast('login', 'PRUEBA', 'Así se ven los avisos', 4000) }, 'Probar aviso'));
}

let data = null;
let tab = 'players';
let filter = '';
const open = new Set();
let timer = null;

function loginView(msg = '') {
  clearInterval(timer);
  stopEvents();
  const email = h('input', { type: 'email', name: 'email', autocomplete: 'username', placeholder: 'tu@correo.com', class: 'bet-input', required: true, 'aria-label': 'Correo' });
  const pass = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', placeholder: 'Contraseña', class: 'bet-input', required: true, 'aria-label': 'Contraseña' });
  const show = h('button', { type: 'button', class: 'btn ghost small', 'aria-pressed': 'false', onclick: () => {
    const on = pass.type === 'password'; pass.type = on ? 'text' : 'password'; show.textContent = on ? 'Ocultar' : 'Mostrar'; show.setAttribute('aria-pressed', String(on));
  } }, 'Mostrar');
  const err = h('p', { class: 'adm-error', role: 'alert' }, msg);
  const submit = h('button', { class: 'btn primary wide', type: 'submit' }, 'Iniciar sesión');
  const form = h('form', { class: 'adm-form', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = ''; submit.disabled = true;
    try { await api('/login', { email: email.value, password: pass.value }); pass.value = ''; await load(); } catch (x) {
      err.textContent = x.status === 429 ? 'Demasiados intentos, esperá un minuto.' : x.status === 404 ? 'El panel está desactivado (falta configurar ADMIN_PASSWORD).' : 'Correo o contraseña incorrectos.';
      pass.select();
    } finally { submit.disabled = false; }
  } },
  h('label', { class: 'field-label' }, 'Correo'), email,
  h('label', { class: 'field-label' }, 'Contraseña'), h('div', { class: 'adm-passrow' }, pass, show),
  err, submit);
  root.replaceChildren(h('div', { class: 'adm-overlay' }, h('div', { class: 'panel adm-login', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Iniciar sesión' },
    h('img', { src: '/assets/logo.svg', alt: '', width: 56, height: 56 }), h('h1', {}, 'Administración'), h('p', { class: 'hint' }, 'Acceso solo para el dueño del casino.'), form)));
  email.focus();
}

function card(label, value, signedClass) {
  return h('div', { class: 'panel adm-card' }, h('small', {}, label), h('b', { class: signedClass || '' }, value));
}

function gamesTable(d) {
  const rows = d.games.map((g) => h('tr', {},
    h('td', {}, gname(g.game)), h('td', { class: 'num' }, num(g.rounds)), h('td', { class: 'num' }, num(g.wagered)), h('td', { class: 'num' }, num(g.paid)),
    h('td', { class: 'num ' + cls(g.house) }, signed(g.house)), h('td', { class: 'num' }, g.wagered ? (g.paid / g.wagered * 100).toFixed(1) + ' %' : '—')));
  return h('div', { class: 'adm-scroll' }, h('table', { class: 'adm-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Juego'), h('th', { class: 'num' }, 'Rondas'), h('th', { class: 'num' }, 'Apostado'), h('th', { class: 'num' }, 'Pagado'),
      h('th', { class: 'num' }, 'Resultado casa'), h('th', { class: 'num' }, 'Devuelto'))),
    h('tbody', {}, ...(rows.length ? rows : [h('tr', {}, h('td', { colspan: 6 }, 'Todavía no se jugó ninguna ronda con apuesta.'))]))));
}

function playersTable(d) {
  const q = filter.trim().toLowerCase();
  const list = d.players.filter((p) => !q || p.name.toLowerCase().includes(q) || p.uuid.toLowerCase().includes(q) || p.ips.some((i) => i.ip.includes(q)));
  const body = [];
  for (const p of list) {
    body.push(h('tr', { class: 'row', onclick: () => { if (open.has(p.uuid)) open.delete(p.uuid); else open.add(p.uuid); render(); } },
      h('td', {}, h('b', {}, p.name), h('span', { class: 'adm-uuid' }, p.uuid.slice(0, 8) + '…')),
      h('td', {}, ...(p.ips.length ? p.ips.slice(0, 3).map((i) => h('span', { class: 'adm-ip' }, i.ip, h('small', {}, ` · ${i.n}×`))) : ['—'])),
      h('td', {}, when(p.lastLogin)), h('td', { class: 'num' }, num(p.logins)), h('td', { class: 'num' }, num(p.balance)),
      h('td', { class: 'num' }, num(p.rounds)), h('td', { class: 'num' }, num(p.wagered)),
      h('td', { class: 'num ' + cls(p.net) }, p.rounds ? `${signed(p.net)} ${p.net > 0 ? '(gana)' : p.net < 0 ? '(pierde)' : ''}` : '—')));
    if (open.has(p.uuid)) {
      const g = Object.entries(p.games);
      body.push(h('tr', { class: 'detail' }, h('td', { colspan: 8 },
        h('div', { class: 'adm-scroll' }, h('table', { class: 'adm-table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Juego'), h('th', { class: 'num' }, 'Rondas'), h('th', { class: 'num' }, 'Apostó'), h('th', { class: 'num' }, 'Cobró'), h('th', { class: 'num' }, 'Neto'))),
          h('tbody', {}, ...(g.length ? g.map(([k, s]) => h('tr', {}, h('td', {}, gname(k)), h('td', { class: 'num' }, num(s.rounds)), h('td', { class: 'num' }, num(s.wagered)),
            h('td', { class: 'num' }, num(s.paid)), h('td', { class: 'num ' + cls(s.net) }, signed(s.net)))) : [h('tr', {}, h('td', { colspan: 5 }, 'Sin jugadas con apuesta.'))])))),
        p.ips.length ? h('p', { class: 'adm-note' }, 'IP usadas: ' + p.ips.map((i) => `${i.ip} (${i.n}×, última ${when(i.last)})`).join(' · ')) : null,
        h('p', { class: 'adm-note' }, `UUID completo: ${p.uuid} · Primera vez: ${when(p.created)}`))));
    }
  }
  const search = h('input', { type: 'search', class: 'bet-input adm-search', placeholder: 'Buscar por nombre, UUID o IP', value: filter, 'aria-label': 'Buscar jugador',
    oninput: (e) => { filter = e.target.value; render(true); } });
  return h('div', {}, search, h('div', { class: 'adm-scroll' }, h('table', { class: 'adm-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Jugador'), h('th', {}, 'IP'), h('th', {}, 'Último ingreso'), h('th', { class: 'num' }, 'Ingresos'), h('th', { class: 'num' }, 'Saldo'),
      h('th', { class: 'num' }, 'Rondas'), h('th', { class: 'num' }, 'Apostado'), h('th', { class: 'num' }, 'Neto del jugador'))),
    h('tbody', {}, ...(body.length ? body : [h('tr', {}, h('td', { colspan: 8 }, 'Sin resultados.'))])))),
  h('p', { class: 'adm-note' }, 'Tocá una fila para ver el detalle por juego. «Neto» = lo cobrado menos lo apostado: positivo gana el jugador, negativo gana la casa.'));
}

function loginsTable(d) {
  return h('div', { class: 'adm-scroll' }, h('table', { class: 'adm-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Fecha'), h('th', {}, 'Jugador'), h('th', {}, 'IP'))),
    h('tbody', {}, ...(d.logins.length ? d.logins.map((l) => h('tr', {}, h('td', {}, when(l.t)), h('td', {}, l.name), h('td', {}, h('span', { class: 'adm-ip' }, l.ip,
      l.sock ? h('small', {}, ` · conexión: ${l.sock}`) : null)))) : [h('tr', {}, h('td', { colspan: 3 }, 'Nadie ingresó todavía.'))]))));
}

function recentTable(d) {
  return h('div', { class: 'adm-scroll' }, h('table', { class: 'adm-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Fecha'), h('th', {}, 'Jugador'), h('th', {}, 'Juego'), h('th', { class: 'num' }, 'Apostó'), h('th', { class: 'num' }, 'Cobró'), h('th', { class: 'num' }, 'Resultado'))),
    h('tbody', {}, ...(d.recent.length ? d.recent.map((r) => h('tr', {}, h('td', {}, when(r.t)), h('td', {}, r.name), h('td', {}, gname(r.game)), h('td', { class: 'num' }, num(r.stake)),
      h('td', { class: 'num' }, num(r.payout)), h('td', { class: 'num ' + cls(r.payout - r.stake) }, r.payout > r.stake ? 'Ganó ' + num(r.payout - r.stake) : r.payout < r.stake ? 'Perdió ' + num(r.stake - r.payout) : 'Empate'))) :
      [h('tr', {}, h('td', { colspan: 6 }, 'Sin jugadas todavía.'))]))));
}

function render(keepFocus) {
  if (!data) return;
  const d = data;
  const tabs = [['players', 'Jugadores'], ['logins', 'Ingresos'], ['recent', 'Jugadas']];
  const view = h('div', {},
    h('div', { class: 'adm-top' }, h('h1', {}, 'Administración'),
      h('div', { class: 'adm-actions' }, h('small', {}, `Actualizado ${when(d.now)}${d.demo ? ' · MODO DEMO' : ''}`),
        h('button', { class: 'btn small', type: 'button', onclick: () => load() }, 'Actualizar'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: async () => { try { await api('/logout', {}); } catch { /* igual */ } data = null; stopEvents(); loginView(); } }, 'Salir'))),
    h('div', { class: 'adm-cards' },
      card('Jugadores', num(d.total.players)), card('Rondas', num(d.total.rounds)), card('Apostado', num(d.total.wagered)), card('Pagado', num(d.total.paid)),
      card('Resultado de la casa', signed(d.total.house), cls(d.total.house))),
    prefsView(),
    h('section', { class: 'panel adm-section' }, h('h2', {}, 'Por juego'), gamesTable(d),
      h('p', { class: 'adm-note' }, `Cifras en ${d.currency}. Solo cuentan rondas con apuesta; las de práctica no se registran.`)),
    h('section', { class: 'panel adm-section' },
      h('div', { class: 'adm-tabs' }, ...tabs.map(([k, label]) => h('button', { type: 'button', class: 'btn small' + (tab === k ? ' primary' : ''), onclick: () => { tab = k; render(); } }, label))),
      tab === 'players' ? playersTable(d) : tab === 'logins' ? loginsTable(d) : recentTable(d)));
  const active = document.activeElement;
  const hadSearch = keepFocus && active && active.classList && active.classList.contains('adm-search');
  const pos = hadSearch ? active.selectionStart : 0;
  root.replaceChildren(view);
  if (hadSearch) { const s = root.querySelector('.adm-search'); s.focus(); s.setSelectionRange(pos, pos); }
}

async function load() {
  try {
    data = await api('/overview');
    render();
    if (!evtTimer) startEvents();
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden && !document.activeElement?.classList?.contains('adm-search')) load().catch(() => {}); }, 30000);
  } catch (e) {
    if (e.status === 401) loginView(); else if (e.status === 404) loginView('El panel está desactivado: falta configurar ADMIN_PASSWORD.');
    else loginView('No se pudo cargar. Reintentá.');
  }
}

load();
