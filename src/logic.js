// Lógica pura do jogo: classificação de mão, interpretação de gestos e física.
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
    startFactor: 0.3, // 30% ao começar a segurar
    rampSeconds: 1.0, // chega a 100% em 1 s
  },
  hand: {
    // razão (distância média ponta→centro da palma) / tamanho da palma
    closeBelow: 0.7,
    openAbove: 0.85,
  },
  shiftConfirmMs: 200,
  steer: {
    deadZoneDeg: 4,
    maxDeg: 45,
    smoothingTau: 0.08, // constante de tempo da EMA, em segundos
  },
  maxDt: 0.05,
};

// ---------------------------------------------------------------------------
// Mão: abertura e classificação com histerese

const TIPS = [8, 12, 16, 20];
const PALM = [0, 5, 9, 13, 17];

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.hypot(dx, dy, dz);
}

/** Abertura normalizada pelo tamanho da palma (invariante à distância da câmera). */
export function handOpenness(landmarks) {
  const c = { x: 0, y: 0, z: 0 };
  for (const i of PALM) {
    c.x += landmarks[i].x / PALM.length;
    c.y += landmarks[i].y / PALM.length;
    c.z += (landmarks[i].z ?? 0) / PALM.length;
  }
  const palmSize = dist(landmarks[0], landmarks[9]);
  if (palmSize === 0) return 0;
  let sum = 0;
  for (const i of TIPS) sum += dist(landmarks[i], c);
  return sum / TIPS.length / palmSize;
}

/** Histerese: só fecha abaixo de closeBelow, só reabre acima de openAbove. */
export function classifyHand(openness, prevState, cfg = CONFIG.hand) {
  if (prevState === 'closed') return openness > cfg.openAbove ? 'open' : 'closed';
  if (prevState === 'open') return openness < cfg.closeBelow ? 'closed' : 'open';
  return openness < (cfg.closeBelow + cfg.openAbove) / 2 ? 'closed' : 'open';
}

/** Limiares a partir de amostras de calibração (semiaberta conta como aberta). */
export function thresholdsFromCalibration(openValue, closedValue) {
  const gap = openValue - closedValue;
  if (!(gap > 0.1)) return null;
  return {
    closeBelow: closedValue + 0.35 * gap,
    openAbove: closedValue + 0.55 * gap,
  };
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

/**
 * Entrada por frame: { left: 'open'|'closed'|null, right: ..., angleDeg: number|null }
 * null = mão não detectada.
 * Saída: { mode, steerDeg, braking, brakeFactor, shift }
 */
export class GestureInterpreter {
  constructor(cfg = CONFIG) {
    this.cfg = cfg;
    this.steerDeg = 0;
    this.shiftArmed = true;
    this.pending = null; // { dir, since }
    this.brakeHold = 0;
  }

  update(input, nowMs, dt) {
    const { left, right } = input;
    let mode;
    let shift = 0;
    let braking = false;

    if (left == null || right == null) {
      // mão fora do quadro: direção travada, sem freio, sem troca
      mode = 'lost';
      this.pending = null;
    } else if (left === 'open' && right === 'open') {
      mode = 'steer';
      this.pending = null;
      this.shiftArmed = true;
      if (input.angleDeg != null) {
        const target = shapeSteer(input.angleDeg, this.cfg.steer);
        const k = 1 - Math.exp(-dt / this.cfg.steer.smoothingTau);
        this.steerDeg += (target - this.steerDeg) * k;
      }
    } else if (left === 'closed' && right === 'closed') {
      mode = 'brake';
      braking = true;
      this.pending = null;
      // depois do freio, só troca de novo com as duas mãos abertas
      this.shiftArmed = false;
    } else {
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
    }

    this.brakeHold = braking ? this.brakeHold + dt : 0;
    const b = this.cfg.brake;
    const brakeFactor = braking
      ? Math.min(1, b.startFactor + (1 - b.startFactor) * (this.brakeHold / b.rampSeconds))
      : 0;

    return { mode, steerDeg: this.steerDeg, braking, brakeFactor, shift };
  }
}

// ---------------------------------------------------------------------------
// Física longitudinal

export class CarPhysics {
  constructor(cfg = CONFIG) {
    this.cfg = cfg;
    this.gear = cfg.gears.initial;
    this.speedKmh = 0;
  }

  get ceilingKmh() {
    return this.cfg.gears.ceilingKmh[this.gear];
  }

  update(dt, { braking, brakeFactor, shift }) {
    dt = Math.min(dt, this.cfg.maxDt);
    const g = this.cfg.gears;
    if (shift) this.gear = Math.max(g.min, Math.min(g.max, this.gear + shift));

    if (braking) {
      this.speedKmh = Math.max(0, this.speedKmh - this.cfg.brake.maxDecelKmhPerS * brakeFactor * dt);
    } else if (this.speedKmh < this.ceilingKmh) {
      // v += (teto[g] − v) · taxa[g] · dt
      this.speedKmh += (this.ceilingKmh - this.speedKmh) * g.rate[this.gear] * dt;
    }
    // acima do teto (após reduzir marcha): aceleração zero, velocidade mantida
    return this.speedKmh;
  }
}
