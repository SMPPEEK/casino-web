// Cartas de píxeles: baraja española (Truco) e inglesa con comodines (La Loba). Todo se dibuja con SVG
// generado desde cuadrículas ASCII; no hay imágenes por carta.
import { h, s } from './ui.js';

// --------------------------------------------------------------------- píxeles
/** Convierte filas de texto (un carácter por píxel, "." = vacío) en un <svg> nítido. */
function pixels(rows, pal, cls) {
  const W = Math.max(...rows.map((r) => r.length));
  const rects = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === '.' || !pal[ch]) { x++; continue; }
      let e = x;
      while (e < row.length && row[e] === ch) e++;
      rects.push(s('rect', { x, y, width: e - x, height: 1, fill: pal[ch] }));
      x = e;
    }
  });
  return s('svg', { viewBox: `0 0 ${W} ${rows.length}`, class: cls, 'shape-rendering': 'crispEdges', 'aria-hidden': 'true' }, ...rects);
}

const ES_SUITS = {
  E: { name: 'espadas', pal: { k: '#1d1d24', w: '#e6edf5', g: '#9fb0c4', y: '#e8b923', b: '#8a5a2b' }, rows: [
    '....k....',
    '...kwk...',
    '...kwk...',
    '...kwk...',
    '...kgk...',
    '...kgk...',
    '.kkkykkk.',
    '.kyyyyyk.',
    '...kbk...',
    '...kbk...',
    '...kyk...',
  ] },
  B: { name: 'bastos', pal: { k: '#2b1a0b', b: '#9b6b3a', c: '#c8925a', d: '#6e4824' }, rows: [
    '...kkk...',
    '..kccck..',
    '.kcbbbbk.',
    '.kbbdbbk.',
    '..kbbbk..',
    '...kbk...',
    '...kdk...',
    '..kbbbk..',
    '..kbbbk..',
    '...kkk...',
  ] },
  O: { name: 'oros', pal: { k: '#6b4600', y: '#e8b923', Y: '#ffe27a', o: '#9a6b00' }, rows: [
    '..kkkkk..',
    '.kYYYYyk.',
    'kYyyyyyyk',
    'kYyooyyyk',
    'kYyoYoyyk',
    'kYyooyyyk',
    'kyyyyyyyk',
    '.kyyyyyk.',
    '..kkkkk..',
  ] },
  C: { name: 'copas', pal: { k: '#1d1d24', w: '#dff3ff', r: '#c4161f', R: '#ff6b6b', c: '#c8925a' }, rows: [
    '...kkk...',
    '...kck...',
    '...kwk...',
    '..kwwwk..',
    '.kwrrrwk.',
    'kwrRrrrwk',
    'kwrrrrrwk',
    'kwrrrrrwk',
    '.kwrrrwk.',
    '..kkkkk..',
  ] },
};

const EN_SUITS = {
  S: { name: 'picas', rows: ['....k....', '...kkk...', '..kkkkk..', '.kkkkkkk.', 'kkkkkkkkk', 'kkkkkkkkk', '.kk.k.kk.', '....k....', '...kkk...'] },
  H: { name: 'corazones', rows: ['.kk...kk.', 'kkkk.kkkk', 'kkkkkkkkk', 'kkkkkkkkk', '.kkkkkkk.', '..kkkkk..', '...kkk...', '....k....'] },
  D: { name: 'diamantes', rows: ['....k....', '...kkk...', '..kkkkk..', '.kkkkkkk.', 'kkkkkkkkk', '.kkkkkkk.', '..kkkkk..', '...kkk...', '....k....'] },
  C: { name: 'tréboles', rows: ['...kkk...', '..kkkkk..', '..kkkkk..', '...kkk...', '.kkkkkkk.', 'kkkkkkkkk', 'kkk.k.kkk', '.k..k..k.', '...kkk...'] },
};

const EMBLEMS = {
  crown: { pal: { k: '#3a2a1a', y: '#e8b923', r: '#c4161f', b: '#2f6fd1' }, rows: [
    'y...y...y',
    'yy.yyy.yy',
    'yyyyyyyyy',
    'yryyyyyby',
    'kkkkkkkkk',
  ] },
  cap: { pal: { k: '#3a2a1a', r: '#c4161f', y: '#e8b923', w: '#f4ecd8' }, rows: [
    '....y....',
    '...rrr...',
    '..rrrrr..',
    '..rrrrr..',
    '.rrrrrrr.',
    'rrrrrrrrr',
    'wwwwwwwww',
  ] },
  horse: { pal: { k: '#3a2a1a', b: '#8a5a2b', d: '#5a3a1c', w: '#f4ecd8' }, rows: [
    '.....bb..',
    '....bbbb.',
    '...bbbbbb',
    '..bbwbbbb',
    '.bbbbbbb.',
    'dbbbbbb..',
    'dbbbbb...',
    '.dbbb....',
    '..dd.....',
  ] },
  star: { pal: { k: '#6b4600', y: '#ffd24a', w: '#fff3b0' }, rows: [
    '....y....',
    '....y....',
    '...yyy...',
    'yyyywyyyy',
    '.yyyyyyy.',
    '..yyyyy..',
    '.yyy.yyy.',
    '.yy...yy.',
  ] },
};

const SUIT_FILL = { S: '#15151a', C: '#15151a', H: '#c4161f', D: '#c4161f' };

function esIcon(suit, cls = 'pip') {
  const d = ES_SUITS[suit];
  return pixels(d.rows, d.pal, cls);
}
function enIcon(suit, cls = 'pip') {
  const d = EN_SUITS[suit];
  return pixels(d.rows, { k: SUIT_FILL[suit] }, cls);
}
function emblem(name, cls = 'emblem') {
  const d = EMBLEMS[name];
  return pixels(d.rows, d.pal, cls);
}

/** Icono chico para registros y botones. deck: 'es' | 'en'. */
export function suitIcon(deck, suit, px = 14) {
  const el = deck === 'es' ? esIcon(suit, 'suit-icon') : enIcon(suit, 'suit-icon');
  el.style.width = px + 'px';
  el.style.height = 'auto';
  return el;
}

// ---------------------------------------------------------------------- diseños
const ES_PIPS = {
  1: [[2, 3, 'big']], 2: [[2, 1], [2, 5]], 3: [[2, 1], [2, 3], [2, 5]],
  4: [[1, 1], [3, 1], [1, 5], [3, 5]], 5: [[1, 1], [3, 1], [2, 3], [1, 5], [3, 5]],
  6: [[1, 1], [3, 1], [1, 3], [3, 3], [1, 5], [3, 5]], 7: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3], [1, 5], [3, 5]],
};
const EN_PIPS = {
  A: [[2, 4, 'big']], 2: [[2, 1], [2, 7]], 3: [[2, 1], [2, 4], [2, 7]], 4: [[1, 1], [3, 1], [1, 7], [3, 7]],
  5: [[1, 1], [3, 1], [2, 4], [1, 7], [3, 7]], 6: [[1, 1], [3, 1], [1, 4], [3, 4], [1, 7], [3, 7]],
  7: [[1, 1], [3, 1], [2, 2], [1, 4], [3, 4], [1, 7], [3, 7]],
  8: [[1, 1], [3, 1], [2, 2], [1, 4], [3, 4], [2, 6], [1, 7], [3, 7]],
  9: [[1, 1], [3, 1], [1, 3], [3, 3], [2, 4], [1, 5], [3, 5], [1, 7], [3, 7]],
  10: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3], [1, 5], [3, 5], [2, 6], [1, 7], [3, 7]],
};

const SIZES = { sm: 'pcard-sm', md: 'pcard-md', lg: 'pcard-lg' };
function decorate(el, opts = {}) {
  el.classList.add(SIZES[opts.size] || SIZES.md);
  if (opts.selected) el.classList.add('is-selected');
  if (opts.disabled) el.classList.add('is-disabled');
  return el;
}

const NAMES_ES = { 1: 'as', 10: 'sota', 11: 'caballo', 12: 'rey' };

/** card = { n: 1..7|10|11|12, s: 'E'|'B'|'O'|'C' } */
export function spanishCard(card, opts = {}) {
  const { n, s: suit } = card;
  const label = `${NAMES_ES[n] || n} de ${ES_SUITS[suit].name}`;
  const body = n >= 10
    ? h('div', { class: 'fig' }, emblem(n === 10 ? 'cap' : n === 11 ? 'horse' : 'crown'), esIcon(suit, 'pip fig-suit'))
    : h('div', { class: 'pips' }, ...ES_PIPS[n].map(([c, r, big]) => {
      const p = esIcon(suit, 'pip' + (big ? ' big' : ''));
      p.style.gridColumn = c;
      p.style.gridRow = r;
      return p;
    }));
  const idx = (cls) => h('span', { class: 'idx ' + cls }, String(n), esIcon(suit, 'idx-suit'));
  const el = h('div', { class: 'pcard pcard-es', 'data-n': n, 'data-s': suit, role: 'img', 'aria-label': label, title: label },
    idx('tl'), body, idx('br'));
  return decorate(el, opts);
}

/** card = { r: 'A','2'..'10','J','Q','K','JOKER', s: 'S'|'H'|'D'|'C'|null } */
export function englishCard(card, opts = {}) {
  const { r, s: suit } = card;
  if (r === 'JOKER') {
    const el = h('div', { class: 'pcard pcard-en joker', role: 'img', 'aria-label': 'comodín', title: 'Comodín' },
      h('span', { class: 'idx tl' }, '★'), h('div', { class: 'fig' }, emblem('star'), h('span', { class: 'joker-text' }, 'COMODÍN')), h('span', { class: 'idx br' }, '★'));
    return decorate(el, opts);
  }
  const red = suit === 'H' || suit === 'D';
  const names = { A: 'as', J: 'jota', Q: 'reina', K: 'rey' };
  const label = `${names[r] || r} de ${EN_SUITS[suit].name}`;
  const face = r === 'J' || r === 'Q' || r === 'K';
  const body = face
    ? h('div', { class: 'fig' }, emblem(r === 'J' ? 'cap' : 'crown'), h('span', { class: 'face-letter' }, r), enIcon(suit, 'pip fig-suit'))
    : h('div', { class: 'pips en' }, ...EN_PIPS[r].map(([c, row, big]) => {
      const p = enIcon(suit, 'pip' + (big ? ' big' : '') + (row > 4 ? ' flip' : ''));
      p.style.gridColumn = c;
      p.style.gridRow = row;
      return p;
    }));
  const idx = (cls) => h('span', { class: 'idx ' + cls }, r, enIcon(suit, 'idx-suit'));
  const el = h('div', { class: 'pcard pcard-en' + (red ? ' red' : ''), 'data-r': r, 'data-s': suit, role: 'img', 'aria-label': label, title: label },
    idx('tl'), body, idx('br'));
  return decorate(el, opts);
}

/** Dorso. kind: 'spanish' | 'english'. */
export function cardBack(kind = 'spanish', opts = {}) {
  const el = h('div', { class: 'pcard pcard-back ' + (kind === 'english' ? 'back-en' : 'back-es'), 'aria-hidden': 'true' });
  return decorate(el, opts);
}
