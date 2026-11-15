// Sonidos sintetizados con WebAudio (no hay archivos de audio que descargar).
let ctx = null;
let muted = false;
try { muted = localStorage.getItem('muted') === '1'; } catch { /* sin storage */ }

function ac() {
  ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur = 0.1, type = 'sine', vol = 0.07, delay = 0, slideTo = null) {
  if (muted) return;
  try {
    const a = ac();
    const o = a.createOscillator();
    const g = a.createGain();
    const t = a.currentTime + delay;
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  } catch { /* audio no disponible */ }
}

export const click = () => tone(520, 0.05, 'square', 0.035);
export const tick = () => tone(300 + Math.random() * 80, 0.04, 'square', 0.025);
export const stop = () => tone(180, 0.12, 'triangle', 0.08);
export const card = () => tone(900, 0.06, 'triangle', 0.05, 0, 400);
export const flip = () => tone(500, 0.35, 'sine', 0.05, 0, 1100);
export const chip = () => tone(700, 0.05, 'triangle', 0.05);
export function win(big = false) {
  const notes = big ? [523, 659, 784, 1047, 1319, 1568] : [523, 659, 784, 1047];
  notes.forEach((f, i) => tone(f, 0.2, 'triangle', 0.08, i * 0.09));
}
export function lose() {
  tone(240, 0.25, 'sawtooth', 0.04);
  tone(170, 0.35, 'sawtooth', 0.04, 0.16);
}

export const isMuted = () => muted;
export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('muted', muted ? '1' : '0'); } catch { /* sin storage */ }
  return muted;
}
