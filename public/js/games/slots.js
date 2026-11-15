import { h, betControl, fmt, sleep } from '../ui.js';

const IDS = ['cherry', 'lemon', 'bell', 'star', 'diamond', 'seven'];
const NAMES = { cherry: 'Manzana', lemon: 'Lingote de hierro', bell: 'Lingote de oro', star: 'Esmeralda', diamond: 'Diamante', seven: 'Siete' };
const rand = () => IDS[Math.floor(Math.random() * IDS.length)];
const img = (id) => h('img', { class: 'cell', src: `/assets/sym-${id}.svg`, alt: NAMES[id], draggable: 'false' });

export default {
  id: 'slots',
  title: 'Tragamonedas',
  icon: 'sym-seven.svg',
  blurb: '3 rodillos · premios hasta ×500',

  mount(root, ctx) {
    let spinning = false;
    let alive = true;

    const reels = [0, 1, 2].map(() => {
      const strip = h('div', { class: 'strip' });
      const win = h('div', { class: 'reel' }, strip);
      const r = { win, strip, cur: rand() };
      setStatic(r, [rand(), r.cur, rand()]);
      return r;
    });

    function setStatic(r, ids) {
      r.strip.style.transition = 'none';
      r.strip.style.transform = 'translateY(0)';
      r.strip.replaceChildren(...ids.map(img));
    }

    function animateReel(r, final, index) {
      const cell = r.win.clientHeight / 3 || 96;
      const n = 16 + index * 8;
      const ids = [rand(), r.cur];
      while (ids.length < n) ids.push(rand());
      ids.push(final, rand());
      const dur = 1.0 + index * 0.45;
      r.strip.style.transition = 'none';
      r.strip.style.transform = 'translateY(0)';
      r.strip.replaceChildren(...ids.map(img));
      void r.strip.offsetHeight; // fuerza el reflow antes de animar
      r.strip.style.transition = `transform ${dur}s cubic-bezier(.17,.67,.2,1)`;
      r.strip.style.transform = `translateY(${-(n - 1) * cell}px)`;
      return new Promise((resolve) => {
        let done = false;
        const end = () => {
          if (done) return;
          done = true;
          if (alive) { setStatic(r, [ids[n - 1], final, ids[n + 1]]); r.cur = final; ctx.sfx.stop(); }
          resolve();
        };
        r.strip.addEventListener('transitionend', end, { once: true });
        setTimeout(end, dur * 1000 + 400); // respaldo si la pestaña estaba en segundo plano
      });
    }

    const bet = betControl(ctx.balance, ctx.config.maxBet, 10);
    const result = h('div', { class: 'result-line' }, 'Elegí tu apuesta y girá.');
    const spinBtn = h('button', { class: 'btn primary big', type: 'button' }, 'GIRAR');

    async function spin() {
      if (spinning) return;
      const stake = bet.get();
      spinning = true;
      spinBtn.disabled = true;
      bet.setDisabled(true);
      result.className = 'result-line';
      result.textContent = 'Girando…';
      reels.forEach((r) => r.win.classList.remove('win'));
      ctx.sfx.click();
      try {
        const res = await ctx.api('/games/slots/spin', { bet: stake });
        ctx.setBalance(res.balance - res.payout);
        const ticker = setInterval(ctx.sfx.tick, 85);
        await Promise.all(reels.map((r, i) => animateReel(r, res.reels[i], i)));
        clearInterval(ticker);
        if (!alive) return;
        if (res.payout > 0) {
          reels.forEach((r, i) => { if (res.win === 'cherry2' ? i < 2 : true) r.win.classList.add('win'); });
          result.className = 'result-line win';
          result.textContent = `¡Ganaste ${fmt(res.payout)}! (×${res.mult})`;
          ctx.sfx.win(res.mult >= 60);
        } else {
          result.className = 'result-line lose';
          result.textContent = 'Sin premio. ¡Suerte para la próxima!';
          ctx.sfx.lose();
        }
        ctx.setBalance(res.balance);
      } catch (e) {
        result.className = 'result-line lose';
        result.textContent = ctx.errMsg(e);
        await sleep(0);
      } finally {
        spinning = false;
        if (alive) { spinBtn.disabled = false; bet.setDisabled(false); }
      }
    }
    spinBtn.addEventListener('click', spin);

    const pay = ctx.config.slots;
    const paytable = h('table', { class: 'paytable' },
      h('caption', {}, 'Premios (× apuesta)'),
      ...[...pay.symbols].reverse().map((s) => h('tr', {},
        h('td', {}, h('span', { class: 'pt-syms' }, img(s.id), img(s.id), img(s.id))),
        h('td', { class: 'mult' }, '×' + s.pay))),
      h('tr', {}, h('td', {}, h('span', { class: 'pt-syms' }, img('cherry'), img('cherry'), h('span', { class: 'any' }, '?'))),
        h('td', { class: 'mult' }, '×' + pay.twoCherries)));

    root.append(
      h('div', { class: 'game-main' },
        h('div', { class: 'slot-machine' },
          h('div', { class: 'slot-top' }, '★ TRAGAMONEDAS ★'),
          h('div', { class: 'reels' }, ...reels.map((r) => r.win), h('div', { class: 'payline' })),
          result)),
      h('aside', { class: 'game-side panel' }, bet.el, spinBtn, paytable));

    return () => { alive = false; };
  },
};
