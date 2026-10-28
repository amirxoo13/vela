let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let analyser: AnalyserNode | null = null;
let noise: AudioBuffer | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function ac() {
  if (!ctx) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = 0.22;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    master.connect(analyser);
    analyser.connect(ctx.destination);
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return ctx;
}

function env(time: number, peak: number, decay: number) {
  const g = ac().createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.001), time + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, time + decay);
  g.connect(master!);
  return g;
}

function kick(time: number) {
  const o = ac().createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(148, time);
  o.frequency.exponentialRampToValueAtTime(46, time + 0.12);
  o.connect(env(time, 0.85, 0.2));
  o.start(time);
  o.stop(time + 0.22);
}

function hat(time: number, peak: number) {
  if (!noise) return;
  const src = ac().createBufferSource();
  src.buffer = noise;
  const filter = ac().createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 6800;
  src.connect(filter);
  filter.connect(env(time, peak, 0.045));
  src.start(time);
  src.stop(time + 0.05);
}

function bass(time: number, semi: number, variant: number) {
  const o = ac().createOscillator();
  o.type = variant === 1 ? "triangle" : "sine";
  const root = variant === 3 ? 49 : 55;
  o.frequency.value = root * 2 ** (semi / 12);
  o.connect(env(time, 0.28, 0.24));
  o.start(time);
  o.stop(time + 0.26);
}

const lines = [
  [0, 0, 3, 0, 5, 5, 3, 0],
  [0, 7, 7, 3, 5, 3, 0, 0],
  [0, 3, 5, 7, 5, 3, 0, 10],
  [0, 0, 0, 3, 5, 3, 0, -2],
];

function hit(time: number, step: number, variant: number) {
  const kicks = variant === 2 ? [0, 7, 10] : [0, 4, 8];
  if (kicks.includes(step)) kick(time);
  if (step % 2 === 1) hat(time, 0.045);
  if (step % 4 === 2) hat(time, 0.02);
  if (step % 2 === 0) bass(time, lines[variant][step / 2] ?? 0, variant);
}

export function startBeat(variant: number) {
  const context = ac();
  void context.resume();
  stopBeat();
  const bpm = [96, 110, 90, 78][variant] ?? 96;
  const stepDur = 60 / bpm / 2;
  let index = 0;
  let next = context.currentTime + 0.05;
  timer = setInterval(() => {
    if (!ctx) return;
    while (next < ctx.currentTime + 0.22) {
      hit(next, index % 16, variant);
      index += 1;
      next += stepDur;
    }
  }, 40);
}

export function stopBeat() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function levels() {
  if (!analyser) return Array.from({ length: 22 }, () => 0.08);
  const bins = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(bins);
  const out: number[] = [];
  const take = 22;
  for (let i = 0; i < take; i++) {
    const idx = Math.min(bins.length - 1, Math.floor((i / take) * bins.length));
    out.push(Math.max(0.08, (bins[idx] ?? 0) / 255));
  }
  return out;
}
