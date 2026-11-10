export type AlertKind = 'done' | 'attention';

declare global {
  interface Window {
    /** End-to-end runs only: the sounds the app asked for, so a test can look at them without audio. */
    __arctriSounds?: Array<{ kind: AlertKind; sessionId?: string }>;
  }
}

// Frequencies in Hz. `done`: a soft rising pair. `attention`: the same note twice, a little more insistent.
const NOTES: Record<AlertKind, { freq: number; at: number; len: number; gain: number }[]> = {
  done: [
    { freq: 659.25, at: 0, len: 0.16, gain: 0.14 },
    { freq: 880, at: 0.12, len: 0.26, gain: 0.14 }
  ],
  attention: [
    { freq: 880, at: 0, len: 0.14, gain: 0.17 },
    { freq: 880, at: 0.18, len: 0.2, gain: 0.17 }
  ]
};

const MIN_GAP_MS = 1500;
let ctx: AudioContext | undefined;
let lastAt = 0;

/**
 * Plays one of the app's own short sounds (synthesized, no files). Several tabs finishing together make one sound, not a pile.
 * `force` skips that limit (the Settings test button). Never throws: no sound is better than a broken page.
 */
export function playAlert(kind: AlertKind, force = false, sessionId?: string): void {
  try {
    const now = Date.now();
    if (!force && now - lastAt < MIN_GAP_MS) return;
    lastAt = now;
    (window.__arctriSounds ??= []).push({ kind, ...(sessionId ? { sessionId } : {}) });
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + 0.01;
    for (const n of NOTES[kind]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.freq;
      const start = t0 + n.at;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(n.gain, start + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, start + n.len);
      osc.connect(g).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + n.len + 0.02);
    }
  } catch {
    /* no audio device, or the context was refused */
  }
}
