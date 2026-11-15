import { h, s, fmt } from '../ui.js';

// Orden real de la ruleta europea (en sentido horario desde el 0).
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n) => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');
const FILL = { green: '#0e7a3a', red: '#c4161f', black: '#17171a' };
const STEP = 360 / WHEEL.length;
const key = (type, value) => `${type}:${value ?? ''}`;

function buildWheel() {
  const pt = (r, a) => [(r * Math.sin((a * Math.PI) / 180)).toFixed(2), (-r * Math.cos((a * Math.PI) / 180)).toFixed(2)];
  const svg = s('svg', { viewBox: '-100 -100 200 200', class: 'wheel-svg', 'aria-hidden': 'true' });
  svg.append(s('circle', { r: 98, fill: '#3b2412', stroke: '#e8b923', 'stroke-width': 3 }));
  WHEEL.forEach((n, i) => {
    const a0 = i * STEP - STEP / 2;
    const a1 = i * STEP + STEP / 2;
    const [x0, y0] = pt(90, a0), [x1, y1] = pt(90, a1), [x2, y2] = pt(60, a1), [x3, y3] = pt(60, a0);
    svg.append(s('path', {
      d: `M${x0} ${y0} A90 90 0 0 1 ${x1} ${y1} L${x2} ${y2} A60 60 0 0 0 ${x3} ${y3}Z`,
      fill: FILL[colorOf(n)], stroke: '#e8b923', 'stroke-width': 0.6,
    }));
    svg.append(s('text', {
      transform: `rotate(${i * STEP}) translate(0 -75)`, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      'font-size': 7.5, 'font-weight': 700, fill: '#fff', 'font-family': 'Georgia, serif',
    }, String(n)));
  });
  svg.append(s('circle', { r: 56, fill: '#2a1a0d', stroke: '#e8b923', 'stroke-width': 2 }));
  svg.append(s('circle', { r: 48, fill: '#0b3d2b', stroke: '#1a1a1a', 'stroke-width': 1 }));
  return svg;
}

export default {
  id: 'roulette',
  title: 'Ruleta',
  icon: 'icon-roulette.svg',
  blurb: 'Europea · un solo cero · pleno paga 35 a 1',

  mount(root, ctx) {
    let spinning = false;
    let alive = true;
    let rot = 0;
    let chipValue = 10;
    const stakes = new Map(); // key -> { type, value, amount }
    const order = []; // para deshacer
    const cells = new Map(); // key -> { btn, badge }
    const last = [];

    const total = () => [...stakes.values()].reduce((a, b) => a + b.amount, 0);

    function refreshBadges() {
      for (const [k, c] of cells) {
        const st = stakes.get(k);
        c.badge.textContent = st ? fmt(st.amount) : '';
        c.badge.hidden = !st;
      }
      totalEl.textContent = fmt(total());
      spinBtn.disabled = spinning || stakes.size === 0;
    }

    function addStake(type, value) {
      if (spinning) return;
      const amount = chipValue;
      if (total() + amount > ctx.config.maxBet) { ctx.toast(`Máximo ${fmt(ctx.config.maxBet)} por giro`, 'lose'); return; }
      if (total() + amount > ctx.balance()) { ctx.toast('No tenés fichas suficientes', 'lose'); return; }
      const k = key(type, value);
      const cur = stakes.get(k);
      if (cur) cur.amount += amount; else stakes.set(k, { type, value, amount });
      order.push(k);
      ctx.sfx.chip();
      refreshBadges();
    }

    function undo() {
      if (spinning) return;
      const k = order.pop();
      if (!k) return;
      const st = stakes.get(k);
      st.amount -= chipValue;
      if (st.amount <= 0) stakes.delete(k);
      refreshBadges();
    }

    function clear() {
      if (spinning) return;
      stakes.clear();
      order.length = 0;
      refreshBadges();
    }

    function cell(label, type, value, cls, col, row) {
      const badge = h('span', { class: 'stake' });
      badge.hidden = true;
      const btn = h('button', { type: 'button', class: 'rc ' + cls, onclick: () => addStake(type, value) }, h('span', {}, label), badge);
      if (col) btn.style.gridColumn = col;
      if (row) btn.style.gridRow = row;
      cells.set(key(type, value), { btn, badge });
      return btn;
    }

    // ---- tablero de apuestas
    const grid = h('div', { class: 'rtable' });
    grid.append(cell('0', 'straight', 0, 'green', '1', '1 / 4'));
    for (let n = 1; n <= 36; n++) {
      grid.append(cell(String(n), 'straight', n, colorOf(n), String(2 + Math.floor((n - 1) / 3)), String(3 - ((n - 1) % 3))));
    }
    grid.append(cell('2:1', 'column', 3, 'out', '14', '1'), cell('2:1', 'column', 2, 'out', '14', '2'), cell('2:1', 'column', 1, 'out', '14', '3'));
    grid.append(
      cell('1ª docena', 'dozen', 1, 'out', '2 / span 4', '4'),
      cell('2ª docena', 'dozen', 2, 'out', '6 / span 4', '4'),
      cell('3ª docena', 'dozen', 3, 'out', '10 / span 4', '4'),
      cell('1–18', 'low', null, 'out', '2 / span 2', '5'),
      cell('Par', 'even', null, 'out', '4 / span 2', '5'),
      cell('Rojo', 'red', null, 'out red', '6 / span 2', '5'),
      cell('Negro', 'black', null, 'out black', '8 / span 2', '5'),
      cell('Impar', 'odd', null, 'out', '10 / span 2', '5'),
      cell('19–36', 'high', null, 'out', '12 / span 2', '5'));

    // ---- ruleta
    const wheelBox = h('div', { class: 'wheel-box' });
    const svg = buildWheel();
    const hub = h('div', { class: 'wheel-hub' }, '·');
    wheelBox.append(svg, h('div', { class: 'wheel-pointer' }), hub);

    // ---- controles
    const chips = [1, 10, 100, 1000].map((v) => {
      const b = h('button', { type: 'button', class: 'chip' + (v === chipValue ? ' sel' : ''), onclick: () => {
        chipValue = v;
        chips.forEach((c) => c.classList.toggle('sel', Number(c.dataset.v) === v));
        ctx.sfx.click();
      }, 'data-v': v }, fmt(v));
      return b;
    });
    const totalEl = h('b', {}, '0');
    const result = h('div', { class: 'result-line' }, 'Elegí una ficha y tocá el tablero.');
    const lastEl = h('div', { class: 'last-numbers' });
    const spinBtn = h('button', { class: 'btn primary big', type: 'button', disabled: true }, 'GIRAR');

    async function spin() {
      if (spinning || stakes.size === 0) return;
      spinning = true;
      spinBtn.disabled = true;
      result.className = 'result-line';
      result.textContent = 'La bola está girando…';
      for (const c of cells.values()) c.btn.classList.remove('win');
      hub.textContent = '·';
      hub.className = 'wheel-hub';
      try {
        const bets = [...stakes.values()].map(({ type, value, amount }) => ({ type, value, amount }));
        const res = await ctx.api('/games/roulette/spin', { bets });
        ctx.setBalance(res.balance - res.payout);
        const idx = WHEEL.indexOf(res.number);
        const target = -idx * STEP;
        const delta = (((target - rot) % 360) + 360) % 360;
        rot += 360 * 5 + delta;
        svg.style.transition = 'transform 4.6s cubic-bezier(.12,.62,.12,1)';
        svg.style.transform = `rotate(${rot}deg)`;
        const tick = setInterval(ctx.sfx.tick, 110);
        await new Promise((r) => setTimeout(r, 4800));
        clearInterval(tick);
        if (!alive) return;
        hub.textContent = String(res.number);
        hub.className = 'wheel-hub ' + res.color;
        last.unshift(res.number);
        if (last.length > 12) last.pop();
        lastEl.replaceChildren(...last.map((n) => h('span', { class: 'ln ' + colorOf(n) }, String(n))));
        for (const r of res.results) if (r.win) cells.get(key(r.type, r.value))?.btn.classList.add('win');
        const net = res.payout - res.stake;
        if (res.payout > 0) {
          result.className = 'result-line win';
          result.textContent = `Salió ${res.number}. Cobrás ${fmt(res.payout)} (${net >= 0 ? '+' : ''}${fmt(net)})`;
          ctx.sfx.win(net >= res.stake * 5);
        } else {
          result.className = 'result-line lose';
          result.textContent = `Salió ${res.number}. Sin premio.`;
          ctx.sfx.lose();
        }
        ctx.setBalance(res.balance);
      } catch (e) {
        result.className = 'result-line lose';
        result.textContent = ctx.errMsg(e);
      } finally {
        spinning = false;
        if (alive) refreshBadges();
      }
    }
    spinBtn.addEventListener('click', spin);

    root.append(
      h('div', { class: 'game-main' },
        h('div', { class: 'roulette-top' }, wheelBox, h('div', { class: 'roulette-info' }, lastEl, result)),
        h('div', { class: 'rtable-wrap' }, grid)),
      h('aside', { class: 'game-side panel' },
        h('label', { class: 'field-label' }, 'Ficha'),
        h('div', { class: 'chips' }, ...chips),
        h('div', { class: 'total-line' }, 'Total apostado: ', totalEl),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn ghost', type: 'button', onclick: undo }, 'Deshacer'),
          h('button', { class: 'btn ghost', type: 'button', onclick: clear }, 'Borrar')),
        spinBtn,
        h('p', { class: 'hint' }, 'Pleno ×36 · Docena y columna ×3 · Rojo/Negro, Par/Impar, 1–18/19–36 ×2')));

    refreshBadges();
    return () => { alive = false; };
  },
};
