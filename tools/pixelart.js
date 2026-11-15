// Genera los SVG de píxeles del tema (arte propio, cuadrículas de 16x16 o 24x24). Uso: node tools/pixelart.js
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'public', 'assets');

function svg(grid, pal) {
  const rows = grid.map((r) => r.padEnd(Math.max(...grid.map((x) => x.length)), '.'));
  const W = rows[0].length, H = rows.length;
  const rects = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < W) {
      const c = row[x];
      if (c === '.' || !pal[c]) { x++; continue; }
      let e = x; while (e < W && row[e] === c) e++;
      rects.push(`<rect x="${x}" y="${y}" width="${e - x}" height="${1}" fill="${pal[c]}"/>`);
      x = e;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">${rects.join('')}</svg>\n`;
}
const save = (name, grid, pal) => fs.writeFileSync(path.join(OUT, name), svg(grid, pal));
const hash = (x, y, s = 0) => { let h = (x * 374761393 + y * 668265263 + s * 2147483647) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return (h ^ (h >>> 16)) >>> 0; };

/** Bloque con borde, bisel y ruido: devuelve cuadrícula + paleta. tones = [claro, medio, oscuro]. */
function block(N, tones, seed = 1, edge = '#1b1208', calm = false) {
  const g = [];
  for (let y = 0; y < N; y++) {
    let row = '';
    for (let x = 0; x < N; x++) {
      if (x === 0 || y === 0 || x === N - 1 || y === N - 1) row += 'k';
      else if (y === 1 || x === 1) row += 'L';
      else if (y === N - 2 || x === N - 2) row += 'D';
      else { const n = hash(x, y, seed) % (calm ? 40 : 7); row += n === 0 ? 'L' : n < (calm ? 1 : 3) ? 'D' : 'M'; }
    }
    g.push(row);
  }
  return { g, pal: { k: edge, L: tones[0], M: tones[1], D: tones[2] } };
}
const put = (g, x0, y0, art, map) => { // dibuja `art` encima de g (arrays de strings) usando map de letras
  art.forEach((r, j) => [...r].forEach((c, i) => {
    if (c === '.') return;
    const row = g[y0 + j]; if (!row) return;
    g[y0 + j] = row.slice(0, x0 + i) + (map[c] || c) + row.slice(x0 + i + 1);
  }));
};

// ------------------------------------------------------------------ símbolos de la tragamonedas
const GEM = [
  '................',
  '................',
  '....kkkkkkkk....',
  '...kLLLwwLLLk...',
  '..kLLwwwwwwLLk..',
  '.kkkkkkkkkkkkkk.',
  '.kLwwwwmmwwwwDk.',
  '..kLwwwmmwwwDk..',
  '...kLwwmmwwDk...',
  '....kLwmmwDk....',
  '.....kLmmDk.....',
  '......kmmk......',
  '.......kk.......',
  '................',
  '................',
  '................',
];
save('sym-diamond.svg', GEM, { k: '#0e3a44', L: '#e9ffff', w: '#7af0f0', m: '#2fc7d1', D: '#1b8d9c' });
const EMERALD = [
  '................',
  '................',
  '.....kkkkkk.....',
  '....kLLwwwwk....',
  '...kLLwwwwmmk...',
  '..kLwwwwwmmmDk..',
  '..kLwwwwmmmmDk..',
  '..kLwwwmmmmmDk..',
  '..kLwwmmmmmDDk..',
  '..kLwmmmmmmDDk..',
  '...kmmmmmmDDk...',
  '....kmmmmDDk....',
  '.....kkkkkk.....',
  '................',
  '................',
  '................',
];
save('sym-star.svg', EMERALD, { k: '#0a3317', L: '#d6ffe3', w: '#62e68c', m: '#17b04f', D: '#0f7a37' });
const INGOT = [
  '................',
  '................',
  '................',
  '................',
  '....kkkkkkkkk...',
  '...kLLLLLLLLLk..',
  '..kLLwwwwwwwwLk.',
  '.kLLwwwwwwwwwwDk',
  '.kLwwwwwwwwwwwDk',
  '.kwwwwwwwwwwwDDk',
  '.kkDDDDDDDDDDDkk',
  '..kkkkkkkkkkkkk.',
  '................',
  '................',
  '................',
  '................',
];
save('sym-lemon.svg', INGOT, { k: '#2b2b33', L: '#ffffff', w: '#d9dde3', D: '#8a929e' });   // lingote de hierro
save('sym-bell.svg', INGOT, { k: '#5a3a00', L: '#fff3a6', w: '#ffd24a', D: '#c28a0a' });      // lingote de oro
const APPLE = [
  '.........gg.....',
  '........ggg.....',
  '.......bg.......',
  '...kkkkbkkkk....',
  '..krrrrrbrrrrk..',
  '.krRRrrrrrrrrrk.',
  '.krRRrrrrrrrrrk.',
  '.krRrrrrrrrrdrk.',
  '.krrrrrrrrrrdrk.',
  '.krrrrrrrrrddrk.',
  '..krrrrrrrrddk..',
  '..krrrrrrrrdk...',
  '...kkrrrrrkk....',
  '.....kkkkk......',
  '................',
  '................',
];
save('sym-cherry.svg', APPLE, { k: '#3a0a0a', r: '#d62828', R: '#ff8a7a', d: '#8e1111', g: '#3fa34d', b: '#6b4423' });
{ // siete dorado
  const b = block(16, ['#fff1a0', '#f5c431', '#b8860b'], 7, '#4a3000');
  put(b.g, 3, 3, ['rrrrrrrrr.', '.......rr.', '......rr..', '.....rr...', '....rr....', '....rr....', '....rr....', '....rr....'], { r: 'r' });
  save('sym-seven.svg', b.g, { ...b.pal, r: '#c4161f' });
}

// ------------------------------------------------------------------ monedas
function coin(emblem, pal) {
  const N = 16, g = [];
  for (let y = 0; y < N; y++) {
    let row = '';
    for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      row += d > 7.9 ? '.' : d > 6.7 ? 'k' : d > 5.7 ? (x + y < 15 ? 'L' : 'D') : 'M';
    }
    g.push(row);
  }
  put(g, 4, 4, emblem, {});
  return g;
}
const CP = { k: '#5a3a00', L: '#fff3a6', M: '#ffd24a', D: '#c28a0a', e: '#a8730a', E: '#fff3a6' };
save('coin-heads.svg', coin(['...ee...', '.e.ee.e.', 'eeeeeeee', 'eeeeeeee', '.eeeeee.', '.e.ee.e.', '..e..e..', '........'].map((r) => r), CP), CP);
save('coin-tails.svg', coin(['...ee...', '..eeee..', '.eeeeee.', 'eeeEEeee', '.eeEEee.', '..eeee..', '...ee...', '........'], CP), CP);

// ------------------------------------------------------------------ logo y favicon (bloque de madera con ficha y tapete)
function logo(N) {
  const b = block(N, ['#c9955a', '#a8743a', '#7a4f26'], 3, '#1b1208');
  const f = Math.round(N / 8);
  // tapete verde arriba
  for (let y = 1; y <= f * 2; y++) {
    let r = b.g[y].split('');
    for (let x = 1; x < N - 1; x++) r[x] = (y === 1) ? 'T' : (hash(x, y, 9) % 5 === 0 ? 'U' : 'G');
    b.g[y] = r.join('');
  }
  // ficha dorada
  const c = [];
  const R = N * 0.27, cx = (N - 1) / 2, cy = N * 0.64;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d <= R + 0.7 && b.g[y][x] !== 'k') {
      const ch = d > R - 0.2 ? 'o' : d > R - 1.3 ? 'Y' : 'y';
      b.g[y] = b.g[y].slice(0, x) + ch + b.g[y].slice(x + 1);
    }
  }
  return { g: b.g, pal: { ...b.pal, T: '#4cc07a', G: '#1f8a4c', U: '#176c3b', o: '#6b4600', Y: '#ffd24a', y: '#f5b800' } };
}
{ const l = logo(24); save('logo.svg', l.g, l.pal); const f = logo(16); save('favicon.svg', f.g, f.pal); }

// ------------------------------------------------------------------ iconos de juegos
{ // dados: dos bloques blancos
  const die = (pips) => { const b = block(11, ['#ffffff', '#ece7d8', '#a9a28c'], 5, '#1b1208', true); pips.forEach(([x, y]) => { b.g[y] = b.g[y].slice(0, x) + 'p' + b.g[y].slice(x + 1); }); return b; };
  const A = die([[3, 3], [7, 3], [5, 5], [3, 7], [7, 7]]);
  const B = die([[3, 3], [7, 7]]);
  const g = Array.from({ length: 20 }, () => '.'.repeat(22));
  put(g, 1, 7, A.g, {}); put(g, 10, 1, B.g, {});
  save('icon-dice.svg', g, { ...A.pal, p: '#1d1d24' });
}
{ // ruleta: disco rojo/negro con centro dorado
  const N = 24, g = [];
  for (let y = 0; y < N; y++) {
    let r = '';
    for (let x = 0; x < N; x++) {
      const dx = x - 11.5, dy = y - 11.5, d = Math.hypot(dx, dy);
      if (d > 11.6) { r += '.'; continue; }
      if (d > 10.4) { r += 'k'; continue; }
      if (d > 8.6) { r += 'w'; continue; }
      if (d < 2.2) { r += 'Y'; continue; }
      if (d < 3.4) { r += 'o'; continue; }
      const a = (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * 12;
      r += Math.floor(a) % 2 ? 'r' : 'b';
    }
    g.push(r);
  }
  g[11] = g[11].slice(0, 11) + 'YY' + g[11].slice(13);
  save('icon-roulette.svg', g, { k: '#1b1208', w: '#c28a0a', Y: '#ffd24a', o: '#6b4600', r: '#c4161f', b: '#1d1d24' });
}
{ // cartas inglesas: as de picas y de corazones
  const card = (suit, col) => {
    const g = block(12, ['#ffffff', '#f6efdc', '#cdbf9c'], 11, '#1b1208', true).g.map((r) => r.replace(/L/g, 'M'));
    put(g, 3, 3, suit, { s: col });
    return g;
  };
  const spade = ['...s...', '..sss..', '.sssss.', 'sssssss', 'sssssss', '.s.s.s.', '...s...'];
  const heart = ['.ss.ss.', 'sssssss', 'sssssss', '.sssss.', '..sss..', '...s...', '.......'];
  const g = Array.from({ length: 20 }, () => '.'.repeat(22));
  put(g, 1, 4, card(spade, 'B'), {}); put(g, 9, 3, card(heart, 'R'), {});
  save('icon-cards.svg', g, { k: '#1b1208', M: '#f6efdc', D: '#cdbf9c', L: '#ffffff', B: '#1d1d24', R: '#c4161f' });
}
{ // truco: carta española (espada) con borde dorado
  const g = block(14, ['#fff7dc', '#f1e4b8', '#c9b27a'], 21, '#2a1d10', true).g;
  const sword = ['..k..', '.kwk.', '.kwk.', '.kwk.', '.kwk.', '.kgk.', 'kyyyk', '.kbk.', '.kyk.'];
  put(g, 5, 3, sword, { w: 'w' });
  const full = Array.from({ length: 20 }, () => '.'.repeat(22));
  put(full, 4, 2, block(14, ['#fff7dc', '#f1e4b8', '#c9b27a'], 21, '#2a1d10', true).g, {});
  // dos cartas inclinadas simuladas: una detrás desplazada
  const back = Array.from({ length: 20 }, () => '.'.repeat(22));
  put(back, 2, 4, block(14, ['#e8a0a0', '#c4161f', '#7a1018'], 4, '#2a1d10').g, {});
  put(back, 7, 1, g, {});
  put(back, 12, 4, ['.....'], {});
  save('icon-truco.svg', back.map((r) => r.slice(0, 22)), { k: '#2a1d10', L: '#fff7dc', M: '#f1e4b8', D: '#c9b27a', w: '#9fb0c4', g: '#9fb0c4', y: '#e8b923', b: '#8a5a2b' });
}
{ // loba: cabeza de lobo (diseño propio)
  const W = [
    '.k..........k...',
    '.kgk......kgk...',
    '.kggk....kggk...',
    '.kgggkkkkgggk...',
    '.kgggggggggggk..',
    '.kggyk.gg.kyggk.',
    '.kgggggggggggk..',
    '..kggggwwgggk...',
    '..kgggwwwwggk...',
    '...kgwwkkwwgk...',
    '....kgwwwwgk....',
    '.....kkkkkk.....',
  ];
  // la cuadrícula anterior es de 16 de ancho; la espejamos para hacerla simétrica
  const mirror = (r) => { const h = r.slice(0, 8); return h + [...h].reverse().join(''); };
  const half = [
    'k.......', 'kgk.....', 'kggk....', 'kgggkkkk', 'kggggggg', 'kgggykgg', 'kggggggg', '.kggggww', '.kgggwww', '..kgwwwk', '...kgwww', '....kkkk',
  ].map(mirror);
  const g = half.concat(['................', '................', '................', '................']);
  save('icon-loba.svg', g, { k: '#1d1d24', g: '#8d949e', y: '#ffd24a', w: '#e6e9ee' });
}

// ------------------------------------------------------------------ texturas de fondo (mosaicos de 16x16)
function tile(name, tones, seed, cluster = 0) {
  const g = [];
  for (let y = 0; y < 16; y++) {
    let r = '';
    for (let x = 0; x < 16; x++) {
      const n = hash(x >> cluster, y >> cluster, seed) % 100;
      r += n < 12 ? 'a' : n < 40 ? 'b' : n < 82 ? 'c' : 'd';
    }
    g.push(r);
  }
  save(name, g, { a: tones[0], b: tones[1], c: tones[2], d: tones[3] });
}
tile('bg-stone.svg', ['#0a1a3a', '#0c2048', '#0f2752', '#122d5e'], 11, 0);
tile('bg-felt.svg', ['#0b3a7a', '#0e4590', '#1150a4', '#155cb8'], 5, 0);
{ // tablones de madera
  const g = [];
  for (let y = 0; y < 16; y++) {
    let r = '';
    for (let x = 0; x < 16; x++) {
      if (y % 8 === 0) r += 'a';
      else if ((y < 8 ? x === 5 : x === 12) && y % 8 !== 0) r += 'a';
      else { const n = hash(x, y, 3) % 10; r += n < 2 ? 'b' : n < 7 ? 'c' : 'd'; }
    }
    g.push(r);
  }
  save('bg-wood.svg', g, { a: '#0a2c66', b: '#1747a0', c: '#1b55bb', d: '#2263cf' });
}
{ // cabeza genérica (avatar de respaldo)
  const g = ['kkkkkkkk','kmmmmmmk','kmmmmmmk','kwbmmbwk','kmmmmmmk','kmddddmk','kmmmmmmk','kkkkkkkk'];
  save('avatar.svg', g, { k: '#1b1208', m: '#c8925a', d: '#7a4f26', w: '#ffffff', b: '#2f6fd1' });
}
console.log('ok');

// ------------------------------------------------------------------ Chicken Road (arte propio)
{
  const chick = [
    '.....rr.....',
    '....rrrr....',
    '...wwwwww...',
    '..wwwkwwww..',
    '..wwwwwwoo..',
    '..wwwwwwoo..',
    '...wwwwwr...',
    '..wwwwwwww..',
    '.wwwwwwwwww.',
    '.wwwwwwwwww.',
    '..wwwwwwww..',
    '...oo..oo...',
  ];
  const P = { r: '#d62828', w: '#fdfdf5', k: '#1b1208', o: '#f08c1a' };
  save('chick.svg', chick, P);
  save('icon-chicken.svg', chick, P);
  save('trap.svg', [
    '.....o......',
    '....oo..o...',
    '...ooyo.oo..',
    '..ooyyooyo..',
    '..oyyyyyyo..',
    '.ooyyYYyyoo.',
    '.oyyYYYYyyo.',
    '.oyYYYYYYyo.',
    '..oyYYYYyo..',
    '...ooyyoo...',
    '..kkkkkkkk..',
    '.kkkkkkkkkk.',
  ], { o: '#d94a00', y: '#ff9a1f', Y: '#ffe36a', k: '#2b2118' });
  save('chick-dead.svg', chick.map((r) => r.replace('k', 'x')), { ...P, x: '#1b1208', w: '#cfcfc0' });
}
