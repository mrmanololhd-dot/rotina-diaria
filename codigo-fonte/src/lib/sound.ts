let ctx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, durationMs: number, when = 0, type: OscillatorType = "sine", gain = 0.15) {
  const c = getCtx();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = 0;
  o.connect(g).connect(c.destination);
  const t0 = c.currentTime + when;
  const t1 = t0 + durationMs / 1000;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.setValueAtTime(gain, t1 - 0.02);
  g.gain.linearRampToValueAtTime(0, t1);
  o.start(t0);
  o.stop(t1 + 0.02);
}

export function playClick() {
  tone(660, 80, 0, "triangle", 0.08);
}
export function playSuccess() {
  tone(660, 90, 0, "sine", 0.12);
  tone(880, 140, 0.1, "sine", 0.12);
}
export function playPomodoroEnd() {
  tone(880, 200, 0, "sine", 0.18);
  tone(660, 200, 0.25, "sine", 0.18);
  tone(880, 350, 0.5, "sine", 0.2);
}
export function playReminder() {
  tone(800, 150, 0, "sine", 0.15);
  tone(1000, 200, 0.18, "sine", 0.15);
}

export type AlarmHandle = { stop: () => void };

export function startAlarm(): AlarmHandle {
  let stopped = false;
  const loop = () => {
    if (stopped) return;
    tone(880, 250, 0, "square", 0.2);
    tone(660, 250, 0.3, "square", 0.2);
    tone(880, 250, 0.6, "square", 0.2);
  };
  loop();
  const id = window.setInterval(loop, 1200);
  return {
    stop: () => {
      stopped = true;
      window.clearInterval(id);
    },
  };
}

export function primeAudio() {
  getCtx();
}