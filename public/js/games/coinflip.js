import { h, betControl, fmt } from '../ui.js';

export default {
  id: 'coinflip',
  title: 'Cara o cruz',
  icon: 'coin-heads.svg',
  blurb: '50 / 50 · paga ×1,96',

  mount(root, ctx) {
    let alive = true;
    let flipping = false;
    let side = 'heads';
    let angle = 0;
    let streak = 0;

    const bet = betControl(ctx.balance, ctx.config.maxBet, 10);
    const inner = h('div', { class: 'coin-inner' },
      h('img', { class: 'face front', src: '/assets/coin-heads.svg', alt: 'Cara', draggable: 'false' }),
      h('img', { class: 'face back', src: '/assets/coin-tails.svg', alt: 'Cruz', draggable: 'false' }));
    const coin = h('div', { class: 'coin' }, inner);
    const result = h('div', { class: 'result-line' }, 'Elegí un lado y tirá la moneda.');
    const streakEl = h('div', { class: 'streak' });
    const headsBtn = h('button', { type: 'button', class: 'active' }, 'Cara');
    const tailsBtn = h('button', { type: 'button' }, 'Cruz');
    const flipBtn = h('button', { class: 'btn primary big', type: 'button' }, 'TIRAR');

    function pick(s) {
      if (flipping) return;
      side = s;
      headsBtn.classList.toggle('active', s === 'heads');
      tailsBtn.classList.toggle('active', s === 'tails');
      ctx.sfx.click();
    }
    headsBtn.addEventListener('click', () => pick('heads'));
    tailsBtn.addEventListener('click', () => pick('tails'));

    async function flip() {
      if (flipping) return;
      const stake = bet.get();
      flipping = true;
      flipBtn.disabled = true;
      bet.setDisabled(true);
      result.className = 'result-line';
      result.textContent = 'La moneda gira…';
      try {
        const res = await ctx.api('/games/coinflip/flip', { bet: stake, side });
        ctx.setBalance(res.balance - res.payout);
        const need = res.result === 'heads' ? 0 : 180;
        angle = Math.ceil((angle + 1440) / 360) * 360 + need; // varias vueltas y cae en el lado correcto
        coin.classList.remove('hop');
        void coin.offsetWidth;
        coin.classList.add('hop');
        inner.style.transition = 'transform 1.7s cubic-bezier(.2,.7,.2,1)';
        inner.style.transform = `rotateY(${angle}deg)`;
        ctx.sfx.flip();
        await new Promise((r) => setTimeout(r, 1800));
        if (!alive) return;
        const name = res.result === 'heads' ? 'Cara' : 'Cruz';
        if (res.win) {
          streak++;
          result.className = 'result-line win';
          result.textContent = `Salió ${name}. ¡Ganaste ${fmt(res.payout)}!`;
          ctx.sfx.win(streak >= 3);
        } else {
          streak = 0;
          result.className = 'result-line lose';
          result.textContent = `Salió ${name}. Perdiste.`;
          ctx.sfx.lose();
        }
        streakEl.textContent = streak >= 2 ? `Racha: ${streak} 🔥` : '';
        ctx.setBalance(res.balance);
      } catch (e) {
        result.className = 'result-line lose';
        result.textContent = ctx.errMsg(e);
      } finally {
        flipping = false;
        if (alive) { flipBtn.disabled = false; bet.setDisabled(false); }
      }
    }
    flipBtn.addEventListener('click', flip);

    root.append(
      h('div', { class: 'game-main' },
        h('div', { class: 'coin-stage' }, coin, streakEl, result)),
      h('aside', { class: 'game-side panel' },
        h('label', { class: 'field-label' }, 'Tu elección'),
        h('div', { class: 'seg' }, headsBtn, tailsBtn),
        bet.el, flipBtn));

    return () => { alive = false; };
  },
};
