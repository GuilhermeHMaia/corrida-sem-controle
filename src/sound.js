// Sons sintetizados com Web Audio (sem arquivos): motor, troca de marcha, batida.
// O AudioContext precisa nascer de um gesto do usuário (clique no botão de início).

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.6;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ctx && !this.muted) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }

  start() {
    if (this.ctx) return;
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);

    // motor: dente-de-serra + quadrada uma oitava abaixo, passando por passa-baixa
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 700;
    this.engineFilter.Q.value = 2;
    this.saw = ctx.createOscillator();
    this.saw.type = 'sawtooth';
    this.sub = ctx.createOscillator();
    this.sub.type = 'square';
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    this.saw.connect(this.engineFilter);
    this.sub.connect(subGain).connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.saw.start();
    this.sub.start();

    // ruído compartilhado pra troca e batida
    const len = ctx.sampleRate * 0.5;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /** rpm ~ quão perto do teto da marcha (0..1+); brake 0..1 */
  updateEngine(speedKmh, ceilingKmh, gear) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = Math.min(1.15, speedKmh / Math.max(1, ceilingKmh));
    const freq = 42 + rpm * 95 + gear * 4;
    this.saw.frequency.setTargetAtTime(freq, t, 0.05);
    this.sub.frequency.setTargetAtTime(freq / 2, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(400 + rpm * 1400, t, 0.08);
    this.engineGain.gain.setTargetAtTime(0.06 + rpm * 0.07, t, 0.1);
  }

  shift() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // corte breve no motor + clack
    this.engineGain.gain.cancelScheduledValues(t);
    this.engineGain.gain.setValueAtTime(0.02, t);
    this.burst({ freq: 1800, q: 4, gain: 0.5, duration: 0.06 });
  }

  crash() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.burst({ freq: 300, q: 0.8, gain: 0.9, duration: 0.25 });
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.25);
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  chime(high = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = high ? [660, 880, 1320] : [880];
    notes.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.1);
      g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.1 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.1 + 0.25);
      osc.connect(g).connect(this.master);
      osc.start(t + i * 0.1);
      osc.stop(t + i * 0.1 + 0.3);
    });
  }

  burst({ freq, q, gain, duration }) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.02);
  }
}
