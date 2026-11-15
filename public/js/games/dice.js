import { h, betControl, fmt, sleep } from '../ui.js';

const RANGE = { under: [2, 95], over: [5, 98] };

export default {
  id: 'dice',
  title: 'Dados',
  icon: 'icon-dice.svg',
  blurb: 'Elegí tu probabilidad · premios hasta ×48',

  mount(root, ctx) {
    let alive = true;
    let rolling = false;
    let mode = 'under';
    const rtp = ctx.config.dice.rtp;

    const bet = betControl(ctx.balance, ctx.config.maxBet, 10);
    const rollNum = h('div', { class: 'dice-roll' }, '--');
    const marker = h('div', { class: 'dice-marker' });
    const bar = h('div', { class: 'dice-bar' }, marker);
    const slider = h('input', { class: 'dice-slider', type: 'range', min: 2, max: 95, step: 1, value: 50, 'aria-label': 'Objetivo' });
    const underBtn = h('button', { type: 'button', class: 'active' }, 'Menor o igual');
    const overBtn = h('button', { type: 'button' }, 'Mayor que');
    const target = () => Number(slider.value);
    const chanceOf = () => (mode === 'under' ? target() : 100 - target());

    const stChance = h('b', {});
    const stMult = h('b', {});
    const stPay = h('b', {});
    const result = h('div', { class: 'result-line' }, 'Ajustá el objetivo y tirá.');
    const rollBtn = h('button', { class: 'btn primary big', type: 'button' }, 'TIRAR');

    function refresh() {
      const chance = chanceOf();
      bar.style.setProperty('--t', target() + '%');
      bar.dataset.mode = mode;
      stChance.textContent = chance + '%';
      stMult.textContent = '×' + (rtp / chance).toFixed(2);
      stPay.textContent = fmt(Math.floor((bet.get() * rtp) / chance));
      underBtn.classList.toggle('active', mode === 'under');
      overBtn.classList.toggle('active', mode === 'over');
    }

    function setMode(m) {
      if (rolling || mode === m) return;
      mode = m;
      const [lo, hi] = RANGE[m];
      slider.min = lo;
      slider.max = hi;
      slider.value = Math.max(lo, Math.min(hi, target()));
      ctx.sfx.click();
      refresh();
    }
    underBtn.addEventListener('click', () => setMode('under'));
    overBtn.addEventListener('click', () => setMode('over'));
    slider.addEventListener('input', refresh);
    bet.input.addEventListener('input', refresh);
    bet.input.addEventListener('change', refresh);

    async function roll() {
      if (rolling) return;
      const stake = bet.get();
      rolling = true;
      rollBtn.disabled = true;
      bet.setDisabled(true);
      slider.disabled = true;
      result.className = 'result-line';
      result.textContent = 'Tirando…';
      rollNum.className = 'dice-roll';
      ctx.sfx.click();
      try {
        const res = await ctx.api('/games/dice/roll', { bet: stake, mode, target: target() });
        ctx.setBalance(res.balance - res.payout);
        for (let i = 0; i < 12 && alive; i++) {
          rollNum.textContent = 1 + Math.floor(Math.random() * 100);
          ctx.sfx.tick();
          await sleep(55 + i * 8);
        }
        if (!alive) return;
        rollNum.textContent = res.roll;
        rollNum.className = 'dice-roll ' + (res.win ? 'win' : 'lose');
        marker.style.left = res.roll + '%';
        marker.classList.add('show');
        if (res.win) {
          result.className = 'result-line win';
          result.textContent = `¡Ganaste ${fmt(res.payout)}! (×${res.mult.toFixed(2)})`;
          ctx.sfx.win(res.mult >= 10);
        } else {
          result.className = 'result-line lose';
          result.textContent = `Salió ${res.roll}. Perdiste.`;
          ctx.sfx.lose();
        }
        ctx.setBalance(res.balance);
      } catch (e) {
        result.className = 'result-line lose';
        result.textContent = ctx.errMsg(e);
        rollNum.textContent = '--';
      } finally {
        rolling = false;
        if (alive) { rollBtn.disabled = false; bet.setDisabled(false); slider.disabled = false; refresh(); }
      }
    }
    rollBtn.addEventListener('click', roll);

    root.append(
      h('div', { class: 'game-main' },
        h('div', { class: 'dice-view' },
          rollNum,
          h('div', { class: 'dice-bar-wrap' }, bar, h('div', { class: 'dice-scale' }, h('span', {}, '1'), h('span', {}, '50'), h('span', {}, '100'))),
          slider,
          h('div', { class: 'dice-target' }, 'Objetivo: ', h('b', {}, ''), ''),
          result)),
      h('aside', { class: 'game-side panel' },
        h('div', { class: 'seg' }, underBtn, overBtn),
        bet.el,
        h('dl', { class: 'dice-stats' },
          h('div', {}, h('dt', {}, 'Probabilidad'), h('dd', {}, stChance)),
          h('div', {}, h('dt', {}, 'Multiplicador'), h('dd', {}, stMult)),
          h('div', {}, h('dt', {}, 'Premio'), h('dd', {}, stPay))),
        rollBtn));

    const tgtLabel = root.querySelector('.dice-target b');
    const origRefresh = refresh;
    // el objetivo también se muestra en el panel principal
    const syncTarget = () => { tgtLabel.textContent = (mode === 'under' ? '≤ ' : '> ') + target(); };
    slider.addEventListener('input', syncTarget);
    underBtn.addEventListener('click', syncTarget);
    overBtn.addEventListener('click', syncTarget);
    origRefresh();
    syncTarget();

    return () => { alive = false; };
  },
};
