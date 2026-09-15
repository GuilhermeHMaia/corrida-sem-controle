// Lógica pura do jogo: classificação de mão, interpretação de gestos, física e voltas.
// Sem dependência de DOM/three/MediaPipe — testável com `node --test`.

export const CONFIG = {
  gears: {
    // índice 0 não é usado; marchas 1..6
    ceilingKmh: [0, 40, 70, 100, 135, 170, 210],
    // taxa cai mais rápido do que o teto sobe (teto·taxa decrescente),
    // senão sair parado em 6ª seria tão bom quanto em 1ª.
    rate: [0, 1.5, 0.6, 0.3, 0.17, 0.1, 0.06],
    min: 1,
    max: 6,
    initial: 1,
  },
  brake: {
    maxDecelKmhPerS: 70,
    minFactor: 0.15, // força do freio quando as mãos acabaram de passar de brakeStart
  },
  hand: {
    // medidas da calibração (dedo mais aberto / tamanho da palma); substituídas pela calibração salva
    calib: { open: 1.3, closed: 0.5 },
    // fechamento: 0 = mão aberta calibrada, 1 = punho calibrado
    brakeStart: 0.7, // a partir daqui as duas mãos freiam (freio leve)
    fullBrakeAt: 0.95, // freio total
    fist: 0.88, // punho "100% fechado": só isso troca marcha
    hysteresis: 0.05,
  },
  shiftConfirmMs: 200,
  steer: {
    deadZoneDeg: 4,
    maxDeg: 45,
    smoothingTau: 0.08, // constante de tempo da EMA, em segundos
    // volante desenhado no cockpit: segue o ângulo das mãos 1:1 (sem zona morta)
    wheelMaxDeg: 90,
    wheelSmoothingTau: 0.04,
  },
  offTrack: {
    ceilingFactor: 0.5, // na grama o teto da marcha cai pela metade
    dragRate: 1.2, // acima do teto reduzido, a velocidade cai em direção a ele
  },
  maxDt: 0.05,
};

// ---------------------------------------------------------------------------
// Mão: abertura, fechamento e classificação com histerese

const TIPS = [8, 12, 16, 20];
const PALM = [0, 5, 9, 13, 17];

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.hypot(dx, dy, dz);
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Abertura normalizada pelo tamanho da palma (invariante à distância da câmera).
 * Usa o dedo MAIS aberto: a mão só conta como fechada com os 4 dedos dobrados.
 */
export function handOpenness(landmarks) {
  const c = { x: 0, y: 0, z: 0 };
  for (const i of PALM) {
    c.x += landmarks[i].x / PALM.length;
    c.y += landmarks[i].y / PALM.length;
    c.z += (landmarks[i].z ?? 0) / PALM.length;
  }
  const palmSize = dist(landmarks[0], landmarks[9]);
  if (palmSize === 0) return 0;
  let max = 0;
  for (const i of TIPS) max = Math.max(max, dist(landmarks[i], c));
  return max / palmSize;
}

/** Fechamento 0..1 relativo à calibração (0 = aberta, 1 = punho). */
export function handClosure(openness, calib = CONFIG.hand.calib) {
  return clamp01((calib.open - openness) / (calib.open - calib.closed));
}

export function isValidCalibration(c) {
  return !!c && Number.isFinite(c.open) && Number.isFinite(c.closed) && c.open - c.closed > 0.1;
}

/**
 * 'open' (volante), 'partial' (zona de freio, ≥ brakeStart) ou 'closed' (punho, ≥ fist).
 * Histerese: pra sair de um nível é preciso abrir `hysteresis` abaixo do limiar de entrada.
 */
export function classifyHand(closure, prevState, cfg = CONFIG.hand) {
  const h = cfg.hysteresis;
  if (closure >= cfg.fist || (prevState === 'closed' && closure >= cfg.fist - h)) return 'closed';
  const partialFloor = prevState === 'closed' || prevState === 'partial' ? cfg.brakeStart - h : cfg.brakeStart;
  return closure >= partialFloor ? 'partial' : 'open';
}

/** Força do freio pelo fechamento médio das mãos: brakeStart → minFactor, fullBrakeAt → 100%. */
export function brakeFactorFromClosure(closure, cfg = CONFIG) {
  const { brakeStart, fullBrakeAt } = cfg.hand;
  const t = clamp01((closure - brakeStart) / (fullBrakeAt - brakeStart));
  return cfg.brake.minFactor + (1 - cfg.brake.minFactor) * t;
}

/**
 * Ângulo do volante em graus a partir dos centros das mãos em coordenadas
 * de TELA espelhada (x cresce pra direita, y pra baixo). Positivo = direita.
 */
export function wheelAngleDeg(leftPt, rightPt) {
  return (Math.atan2(rightPt.y - leftPt.y, rightPt.x - leftPt.x) * 180) / Math.PI;
}

export function shapeSteer(rawDeg, cfg = CONFIG.steer) {
  const a = Math.abs(rawDeg);
  if (a <= cfg.deadZoneDeg) return 0;
  const shaped = Math.min(a - cfg.deadZoneDeg, cfg.maxDeg);
  return Math.sign(rawDeg) * shaped;
}

// ---------------------------------------------------------------------------
// Interpretação dos gestos

const GRIP = new Set(['partial', 'closed']);

/**
 * Entrada por frame: { left, right, leftClosure, rightClosure, angleDeg }
 *   left/right: 'open' | 'partial' | 'closed' | null (null = mão não detectada)
 * Saída: { mode, steerDeg, braking, brakeFactor, shift }
 */
export class GestureInterpreter {
  constructor(cfg = CONFIG) {
    this.cfg = cfg;
    this.steerDeg = 0;
    this.wheelDeg = 0; // ângulo visual do volante (1:1 com as mãos)
    this.shiftArmed = true;
    this.pending = null; // { dir, since }
  }

  update(input, nowMs, dt) {
    const { left, right } = input;
    let mode;
    let shift = 0;
    let braking = false;
    let brakeFactor = 0;

    if (left == null || right == null) {
      // mão fora do quadro: direção travada, sem freio, sem troca
      mode = 'lost';
      this.pending = null;
    } else if (GRIP.has(left) && GRIP.has(right)) {
      mode = 'brake';
      braking = true;
      const closure = ((input.leftClosure ?? 1) + (input.rightClosure ?? 1)) / 2;
      brakeFactor = brakeFactorFromClosure(closure, this.cfg);
      this.pending = null;
      // depois do freio, só troca de novo com as duas mãos abertas
      this.shiftArmed = false;
    } else if (left === 'closed' || right === 'closed') {
      // um punho, a outra mão aberta
      const dir = right === 'closed' ? +1 : -1;
      if (!this.shiftArmed) {
        mode = 'hold';
        this.pending = null;
      } else {
        mode = 'shift-pending';
        if (!this.pending || this.pending.dir !== dir) {
          this.pending = { dir, since: nowMs };
        }
        if (nowMs - this.pending.since >= this.cfg.shiftConfirmMs) {
          shift = dir;
          this.shiftArmed = false; // exige reabrir a mão
          this.pending = null;
          mode = 'shifted';
        }
      }
    } else {
      // volante: as duas abertas, ou uma apertando um pouco (sem chegar no punho)
      mode = 'steer';
      this.pending = null;
      if (left === 'open' && right === 'open') this.shiftArmed = true;
      if (input.angleDeg != null) {
        const s = this.cfg.steer;
        const target = shapeSteer(input.angleDeg, s);
        this.steerDeg += (target - this.steerDeg) * (1 - Math.exp(-dt / s.smoothingTau));
        const wheelTarget = Math.max(-s.wheelMaxDeg, Math.min(s.wheelMaxDeg, input.angleDeg));
        this.wheelDeg += (wheelTarget - this.wheelDeg) * (1 - Math.exp(-dt / s.wheelSmoothingTau));
      }
    }

    return { mode, steerDeg: this.steerDeg, wheelDeg: this.wheelDeg, braking, brakeFactor, shift };
  }
}

// ---------------------------------------------------------------------------
// Física longitudinal

export class CarPhysics {
  constructor(cfg = CONFIG) {
    this.cfg = cfg;
    this.gear = cfg.gears.initial;
    this.speedKmh = 0;
    this.offTrack = false;
  }

  get ceilingKmh() {
    const base = this.cfg.gears.ceilingKmh[this.gear];
    return this.offTrack ? base * this.cfg.offTrack.ceilingFactor : base;
  }

  update(dt, { braking, brakeFactor, shift }, { offTrack = false } = {}) {
    dt = Math.min(dt, this.cfg.maxDt);
    const g = this.cfg.gears;
    this.offTrack = offTrack;
    if (shift) this.gear = Math.max(g.min, Math.min(g.max, this.gear + shift));

    const ceiling = this.ceilingKmh;
    if (braking) {
      this.speedKmh = Math.max(0, this.speedKmh - this.cfg.brake.maxDecelKmhPerS * brakeFactor * dt);
    } else if (this.speedKmh < ceiling) {
      // v += (teto[g] − v) · taxa[g] · dt
      this.speedKmh += (ceiling - this.speedKmh) * g.rate[this.gear] * dt;
    } else if (offTrack) {
      // grama: cai em direção ao teto reduzido
      this.speedKmh += (ceiling - this.speedKmh) * this.cfg.offTrack.dragRate * dt;
    }
    // na pista, acima do teto (após reduzir marcha): aceleração zero, velocidade mantida
    return this.speedKmh;
  }
}

/**
 * Colisão com troncos (círculos no plano). Empurra o carro pra fora e dá um pequeno
 * recuo, pra ter espaço de virar. Muta state {x, z, heading}; retorna true se bateu.
 */
export function resolveTreeCollision(state, trees, carRadius) {
  let hit = false;
  for (const t of trees) {
    const dx = state.x - t.x, dz = state.z - t.z;
    const minDist = carRadius + t.r;
    const d = Math.hypot(dx, dz);
    if (d >= minDist) continue;
    const nx = d > 1e-6 ? dx / d : -Math.sin(state.heading);
    const nz = d > 1e-6 ? dz / d : -Math.cos(state.heading);
    state.x = t.x + nx * (minDist + 0.05) - Math.sin(state.heading) * 1.2;
    state.z = t.z + nz * (minDist + 0.05) - Math.cos(state.heading) * 1.2;
    hit = true;
  }
  return hit;
}

// ---------------------------------------------------------------------------
// Voltas: checkpoints em ordem; índice 0 é a largada/chegada

export class LapTimer {
  constructor(checkpoints, radius, best = null) {
    this.checkpoints = checkpoints;
    this.radius = radius;
    this.best = best;
    this.last = null;
    this.lap = 1;
    this.time = 0;
    this.lapStart = 0;
    this.next = 1 % checkpoints.length;
  }

  get current() {
    return this.time - this.lapStart;
  }

  /** Avança o relógio e checa o próximo checkpoint. Retorna evento ou null. */
  update(dt, x, z) {
    this.time += dt;
    const cp = this.checkpoints[this.next];
    if (Math.hypot(cp.x - x, cp.z - z) > this.radius) return null;

    if (this.next !== 0) {
      const index = this.next;
      this.next = (this.next + 1) % this.checkpoints.length;
      return { type: 'checkpoint', index, total: this.checkpoints.length };
    }
    const lapTime = this.current;
    const isBest = this.best == null || lapTime < this.best;
    if (isBest) this.best = lapTime;
    this.last = lapTime;
    this.lap += 1;
    this.lapStart = this.time;
    this.next = 1 % this.checkpoints.length;
    return { type: 'lap', lapTime, isBest };
  }
}

export function formatLapTime(s) {
  if (s == null) return '--:--.---';
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(3).padStart(6, '0')}`;
}
