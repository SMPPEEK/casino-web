// Utilidades de interfaz. Se construye todo con createElement/textContent (nunca innerHTML con datos).
const SVG_NS = 'http://www.w3.org/2000/svg';

function append(el, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

export function s(tag, props = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(props || {})) el.setAttribute(k, v);
  append(el, children);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const fmt = (n) => Number(n).toLocaleString('es-AR');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function toast(msg, kind = 'info') {
  const box = document.getElementById('toasts');
  const t = h('div', { class: 'toast ' + kind }, msg);
  box.append(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}

/**
 * Control de apuesta reutilizable. getBalance() devuelve el saldo actual; max es la apuesta máxima.
 * Devuelve { el, get(), set(n), setDisabled(bool) }.
 */
export function betControl(getBalance, max, initial = 10) {
  const input = h('input', { class: 'bet-input', type: 'number', min: 1, max, step: 1, inputmode: 'numeric', 'aria-label': 'Apuesta' });
  input.value = initial;

  const clamp = () => {
    const v = Math.floor(Number(input.value));
    input.value = Math.max(1, Math.min(max, Number.isFinite(v) ? v : 1));
    return Number(input.value);
  };
  input.addEventListener('change', clamp);

  const btn = (label, fn, cls = 'chip-btn') =>
    h('button', { type: 'button', class: cls, onclick: () => { clamp(); fn(); clamp(); input.dispatchEvent(new Event('input')); } }, label);

  const quick = [10, 100, 1000].map((n) => btn('+' + (n >= 1000 ? n / 1000 + 'K' : n), () => { input.value = Number(input.value) + n; }));
  const el = h('div', { class: 'bet' },
    h('label', { class: 'field-label' }, 'Apuesta'),
    h('div', { class: 'bet-row' },
      btn('½', () => { input.value = Math.max(1, Math.floor(Number(input.value) / 2)); }),
      input,
      btn('2×', () => { input.value = Number(input.value) * 2; })),
    h('div', { class: 'bet-quick' }, ...quick, btn('Máx', () => { input.value = Math.max(1, Math.min(max, getBalance())); })));

  return {
    el,
    input,
    get: clamp,
    set: (n) => { input.value = n; clamp(); },
    setDisabled: (d) => el.querySelectorAll('button,input').forEach((b) => { b.disabled = d; }),
  };
}
