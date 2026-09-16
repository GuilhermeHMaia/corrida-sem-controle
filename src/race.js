// Lógica pura da corrida e do campeonato: adversários, posições, largada e pontos.
// Sem three/DOM — testável com `node --test`.

export const RACE_LAPS = 3;
export const POINTS = [10, 7, 5, 3];
export const COUNTDOWN_S = 3.2;

export const OPPONENTS = [
  { id: 'v1', name: 'Vieira', color: 0x2f7ddc, pace: 1.04, lane: -3.2, wobble: 0.05 },
  { id: 'v2', name: 'Prado', color: 0xf0f0f0, pace: 0.98, lane: 3.2, wobble: 0.08 },
  { id: 'v3', name: 'Nunes', color: 0xf0a500, pace: 0.9, lane: 0, wobble: 0.12 },
];

/**
 * Perfil de velocidade da pista: quanto mais fechada a curva, menor a velocidade alvo.
 * `curvature` é um array por amostra (rad/m); retorna km/h.
 */
export function paceSpeedKmh(curvature, u, pace) {
  const k = sampleLoop(curvature, u);
  const corner = 1 / (1 + k * 260); // 0..1: 1 em reta, menor em curva fechada
  return (55 + 165 * corner) * pace;
}

function sampleLoop(arr, u) {
  const n = arr.length;
  const i = ((Math.round(u * n) % n) + n) % n;
  return arr[i];
}

/** Um adversário: anda pelo traçado com ritmo próprio e pequenos erros. */
export class AiDriver {
  constructor(spec, { length, curvature }, startU = 0) {
    Object.assign(this, spec);
    this.length = length;
    this.curvature = curvature;
    this.u = ((startU % 1) + 1) % 1;
    this.speedKmh = 0;
    this.lap = 1;
    this.progress = this.u;
    this.finished = false;
    this.finishTime = null;
    this.mistake = 0;
    this.seed = (spec.id.charCodeAt(1) * 7919) % 10000;
  }

  rand() {
    this.seed = (this.seed * 16807 + 11) % 2147483647;
    return this.seed / 2147483647;
  }

  update(dt, time, laps) {
    if (this.finished) return;
    // erro ocasional: perde ritmo por alguns segundos
    if (this.mistake > 0) this.mistake -= dt;
    else if (this.rand() < this.wobble * dt) this.mistake = 0.8 + this.rand() * 1.5;

    const target = paceSpeedKmh(this.curvature, this.u, this.pace) * (this.mistake > 0 ? 0.55 : 1);
    const rate = this.speedKmh < target ? 1.1 : 2.2;
    this.speedKmh += (target - this.speedKmh) * Math.min(1, rate * dt);

    this.u += (this.speedKmh / 3.6) * dt / this.length;
    if (this.u >= 1) {
      this.u -= 1;
      this.lap += 1;
      if (this.lap > laps) {
        this.finished = true;
        this.finishTime = time;
        this.lap = laps;
        this.u = 1;
      }
    }
    this.progress = this.finished ? laps : this.lap - 1 + this.u;
  }

  /** Batida: perde velocidade. */
  bump() {
    this.speedKmh *= 0.55;
    this.mistake = Math.max(this.mistake, 0.5);
  }
}

/**
 * Corrida: contagem regressiva, adversários e classificação.
 * O jogador é atualizado por fora (física própria) e informa lap/u.
 */
export class Race {
  constructor({ track, laps = RACE_LAPS, opponents = OPPONENTS, gridGap = 0.006 }) {
    this.track = track;
    this.laps = laps;
    this.time = 0;
    this.countdown = COUNTDOWN_S;
    this.state = 'countdown'; // 'countdown' | 'running' | 'done'
    this.player = { name: 'Você', isPlayer: true, lap: 1, u: 0, progress: 0, finished: false, finishTime: null };
    // grid: adversários logo à frente da linha, jogador logo atrás dela (em último)
    this.drivers = opponents.map((spec, i) => new AiDriver(spec, track, gridGap * (opponents.length - i)));
    this.playerStartU = 1 - gridGap;
    this.playerCrossed = false; // enquanto não cruza a linha, o progresso é negativo
  }

  update(dt, playerState) {
    if (this.state === 'done') return this.snapshot();
    this.time += dt;
    if (this.state === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) this.state = 'running';
      return this.snapshot();
    }

    for (const d of this.drivers) d.update(dt, this.time, this.laps);

    const p = this.player;
    p.lap = Math.min(playerState.lap, this.laps);
    p.u = playerState.u;
    let u = playerState.u;
    if (!this.playerCrossed) {
      if (u < 0.5) this.playerCrossed = true;
      else u -= 1; // ainda no grid, atrás da linha
    }
    if (!p.finished) {
      p.progress = playerState.lap - 1 + u;
      if (playerState.lap > this.laps) {
        p.finished = true;
        p.finishTime = this.time;
        p.progress = this.laps;
      }
    }
    if (p.finished) this.state = 'done';
    return this.snapshot();
  }

  snapshot() {
    const all = [this.player, ...this.drivers];
    const order = [...all].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      return b.progress - a.progress;
    });
    return {
      state: this.state,
      time: this.time,
      countdown: Math.max(0, this.countdown),
      order: order.map((d, i) => ({
        position: i + 1,
        name: d.name,
        isPlayer: !!d.isPlayer,
        lap: Math.min(d.lap, this.laps),
        finished: d.finished,
        finishTime: d.finishTime,
      })),
      playerPosition: order.findIndex((d) => d.isPlayer) + 1,
    };
  }
}

// ---------------------------------------------------------------------------
// Campeonato

export function pointsFor(position) {
  return POINTS[position - 1] ?? 0;
}

export class Championship {
  constructor(trackIds, saved = null) {
    this.trackIds = trackIds;
    this.results = saved?.results ?? []; // [{trackId, order:[nome...]}]
  }

  get raceIndex() {
    return this.results.length;
  }

  get currentTrackId() {
    return this.trackIds[this.raceIndex] ?? null;
  }

  get done() {
    return this.raceIndex >= this.trackIds.length;
  }

  addResult(trackId, orderNames) {
    this.results.push({ trackId, order: orderNames });
  }

  /** Tabela acumulada, ordenada por pontos (desempate: melhor colocação). */
  table() {
    const rows = new Map();
    for (const r of this.results) {
      r.order.forEach((name, i) => {
        const row = rows.get(name) ?? { name, points: 0, best: Infinity, wins: 0 };
        row.points += pointsFor(i + 1);
        row.best = Math.min(row.best, i + 1);
        if (i === 0) row.wins += 1;
        rows.set(name, row);
      });
    }
    return [...rows.values()].sort((a, b) => b.points - a.points || a.best - b.best);
  }

  toJSON() {
    return { results: this.results };
  }
}
