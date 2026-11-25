// Notification chimes, synthesised with Web Audio (no audio files to load).
// Each notification kind gets its own short motif. Mute is remembered per browser.
const KEY = 'taskflow.sound';
let ctx = null;
let last = 0;

export const isMuted = () => { try { return localStorage.getItem(KEY) === 'off'; } catch { return false; } };
export const setMuted = (m) => { try { localStorage.setItem(KEY, m ? 'off' : 'on'); } catch {} };

function audio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
// Browsers only allow sound after the person has interacted with the page,
// so wake the audio engine on the first tap or key press.
['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, function once() {
  audio(); window.removeEventListener(ev, once, true);
}, true));

// One soft bell strike: a sine with a quiet octave partial and a fast-attack, long-tail envelope.
function strike(ac, out, freq, at, { dur = 0.9, vol = 0.22, type = 'sine' } = {}) {
  [[1, 1, type], [2, 0.18, 'sine'], [3.01, 0.06, 'sine']].forEach(([mult, gain, wave]) => {
    const o = ac.createOscillator(); const g = ac.createGain();
    o.type = wave; o.frequency.setValueAtTime(freq * mult, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol * gain, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur / mult ** 0.5);
    o.connect(g).connect(out); o.start(at); o.stop(at + dur + 0.05);
  });
}

const N = (n) => 440 * 2 ** ((n - 69) / 12); // MIDI note to Hz
// [midi note, start offset in s, options]
const MOTIFS = {
  green:  [[84, 0], [88, 0.09], [91, 0.18], [96, 0.27, { dur: 1.3 }]],         // bright rising arpeggio: done
  red:    [[76, 0, { type: 'triangle', vol: 0.2 }], [71, 0.16, { type: 'triangle', vol: 0.2, dur: 1.1 }]], // falling two-note alert
  orange: [[79, 0], [74, 0.14, { dur: 1.1 }]],                                  // gentle downward pause
  purple: [[88, 0, { vol: 0.15 }], [93, 0.06, { vol: 0.15 }], [100, 0.12, { vol: 0.13, dur: 1.2 }]], // quick sparkle: mention
  blue:   [[81, 0], [88, 0.12, { dur: 1.2 }]],                                  // classic soft ding-dong up
  gray:   [[76, 0, { vol: 0.16, dur: 0.7 }]],                                   // single quiet tick
};

export function chime(tone = 'blue', { force = false } = {}) {
  if (!force && isMuted()) return;
  const now = performance.now();
  if (!force && now - last < 700) return; // a burst of notifications plays once
  last = now;
  const ac = audio(); if (!ac) return;
  const out = ac.createGain(); out.gain.value = 0.9;
  // Light echo makes the bell feel roomier without a reverb file.
  const delay = ac.createDelay(); delay.delayTime.value = 0.16;
  const fb = ac.createGain(); fb.gain.value = 0.22;
  out.connect(ac.destination); out.connect(delay); delay.connect(fb).connect(delay); delay.connect(ac.destination);
  const t0 = ac.currentTime + 0.02;
  (MOTIFS[tone] || MOTIFS.blue).forEach(([n, off, opts]) => strike(ac, out, N(n), t0 + off, opts));
}
