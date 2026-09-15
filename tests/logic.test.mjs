import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG, GestureInterpreter, CarPhysics, LapTimer, classifyHand, shapeSteer, resolveTreeCollision,
  wheelAngleDeg, handOpenness, handClosure, isValidCalibration, brakeFactorFromClosure, formatLapTime,
} from '../src/logic.js';

// Mão sintética: pulso na origem, MCPs em y=1 (palma = 1), cada dedo dobrado ou esticado.
function fakeHand(extended /* [indicador, médio, anelar, mínimo] */) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  const mcp = { 5: -0.3, 9: 0, 13: 0.3, 17: 0.55 };
  for (const [i, x] of Object.entries(mcp)) lm[i] = { x, y: 1, z: 0 };
  [8, 12, 16, 20].forEach((tip, k) => {
    const x = mcp[tip - 3];
    lm[tip] = extended[k] ? { x, y: 2, z: 0 } : { x: x * 0.5, y: 0.6, z: 0.15 };
  });
  return lm;
}

const O = 'open', P = 'partial', C = 'closed';
const DT = 1 / 60;
const closureOf = { open: 0.2, partial: 0.8, closed: 1 };

function run(gi, frames, startMs = 0) {
  let t = startMs;
  const outs = [];
  for (const [left, right, ms, angleDeg = 0] of frames) {
    const n = Math.round(ms / (DT * 1000));
    for (let i = 0; i < n; i++) {
      t += DT * 1000;
      outs.push(gi.update({
        left, right, angleDeg, leftClosure: closureOf[left], rightClosure: closureOf[right],
      }, t, DT));
    }
  }
  return outs;
}
const shifts = (outs) => outs.filter((o) => o.shift !== 0).map((o) => o.shift);
const coast = { braking: false, brakeFactor: 0, shift: 0 };

test('punho direito por 200ms sobe uma marcha, uma vez só', () => {
  const gi = new GestureInterpreter();
  assert.deepEqual(shifts(run(gi, [[O, O, 100], [O, C, 1000]])), [+1]);
});

test('punho esquerdo desce marcha', () => {
  const gi = new GestureInterpreter();
  assert.deepEqual(shifts(run(gi, [[O, O, 100], [C, O, 300]])), [-1]);
});

test('mão só parcialmente fechada (zona de freio) não troca marcha', () => {
  const gi = new GestureInterpreter();
  const outs = run(gi, [[O, O, 100], [O, P, 1000]]);
  assert.deepEqual(shifts(outs), []);
  assert.ok(outs.every((o) => !o.braking));
});

test('reabrir a mão rearma a troca', () => {
  const gi = new GestureInterpreter();
  assert.deepEqual(shifts(run(gi, [[O, O, 50], [O, C, 300], [O, O, 50], [O, C, 300]])), [+1, +1]);
});

test('reabrir só até a zona parcial não rearma', () => {
  const gi = new GestureInterpreter();
  assert.deepEqual(shifts(run(gi, [[O, O, 50], [O, C, 300], [O, P, 100], [O, C, 300]])), [+1]);
});

test('entrar no freio passando por um punho rápido não troca marcha', () => {
  const gi = new GestureInterpreter();
  const outs = run(gi, [[O, O, 100], [O, C, 150], [P, C, 500]]);
  assert.deepEqual(shifts(outs), []);
  assert.equal(outs.at(-1).braking, true);
});

test('soltar o freio abrindo uma mão por vez não troca marcha', () => {
  const gi = new GestureInterpreter();
  assert.deepEqual(shifts(run(gi, [[O, O, 50], [C, C, 500], [O, C, 800], [O, O, 50]])), []);
});

test('força do freio pelo fechamento: 70% leve, 100% total, cresce no meio', () => {
  const at = (c) => brakeFactorFromClosure(c);
  assert.equal(at(0.7), CONFIG.brake.minFactor);
  assert.equal(at(1), 1);
  assert.ok(at(0.8) > at(0.7) && at(0.9) > at(0.8) && at(0.9) < 1);
  const gi = new GestureInterpreter();
  const light = run(gi, [[P, P, 100]]).at(-1).brakeFactor;
  const full = run(gi, [[C, C, 100]], 1000).at(-1).brakeFactor;
  assert.ok(light < full);
  assert.equal(full, 1);
});

test('direção atualiza com mãos abertas (ou uma apertando), trava no freio/troca/mão perdida', () => {
  const gi = new GestureInterpreter();
  const a = run(gi, [[O, O, 1000, 24]]);
  assert.ok(Math.abs(a.at(-1).steerDeg - 20) < 0.1); // 24 - zona morta 4
  const locked = a.at(-1).steerDeg;
  const b = run(gi, [[O, C, 100, -30], [C, C, 300, -30]], 2000);
  assert.ok(b.every((o) => Math.abs(o.steerDeg - locked) < 1e-9));
  const c = run(gi, [[null, O, 300, -30]], 3000);
  assert.ok(c.every((o) => o.mode === 'lost' && !o.braking && o.shift === 0));
  assert.ok(Math.abs(c.at(-1).steerDeg - locked) < 1e-9);
  const d = run(gi, [[P, O, 1000, -10]], 4000);
  assert.equal(d.at(-1).mode, 'steer');
  assert.ok(d.at(-1).steerDeg < 0);
});

test('classificação em 3 níveis com histerese', () => {
  assert.equal(classifyHand(0.5, 'open'), 'open');
  assert.equal(classifyHand(0.72, 'open'), 'partial');
  assert.equal(classifyHand(0.67, 'partial'), 'partial'); // histerese
  assert.equal(classifyHand(0.6, 'partial'), 'open');
  assert.equal(classifyHand(0.86, 'partial'), 'partial');
  assert.equal(classifyHand(0.9, 'partial'), 'closed');
  assert.equal(classifyHand(0.85, 'closed'), 'closed'); // histerese
  assert.equal(classifyHand(0.8, 'closed'), 'partial');
});

test('fechamento relativo à calibração; punho só com os 4 dedos dobrados', () => {
  const fist = handOpenness(fakeHand([false, false, false, false]));
  const open = handOpenness(fakeHand([true, true, true, true]));
  const calib = { open, closed: fist };
  assert.ok(isValidCalibration(calib));
  assert.equal(isValidCalibration({ open: 0.6, closed: 0.55 }), false);
  assert.equal(handClosure(fist, calib), 1);
  assert.equal(handClosure(open, calib), 0);
  assert.equal(classifyHand(handClosure(fist, calib), 'open'), 'closed');
  for (let k = 0; k < 4; k++) {
    const oneOut = fakeHand([0, 1, 2, 3].map((i) => i === k));
    assert.notEqual(classifyHand(handClosure(handOpenness(oneOut), calib), 'open'), 'closed', `dedo ${k} esticado`);
  }
});

test('ângulo do volante: mão direita mais baixa = positivo (vira pra direita)', () => {
  assert.ok(wheelAngleDeg({ x: 0, y: 0 }, { x: 10, y: 5 }) > 0);
  assert.equal(shapeSteer(3), 0);
  assert.equal(shapeSteer(-100), -CONFIG.steer.maxDeg);
});

test('física: começa em 1ª, acelera até perto do teto e nunca passa', () => {
  const car = new CarPhysics();
  assert.equal(car.gear, 1);
  for (let i = 0; i < 600; i++) car.update(DT, coast);
  assert.ok(car.speedKmh > 39 && car.speedKmh <= 40);
});

test('física: sair parado em marcha alta é mais lento que em 1ª', () => {
  const low = new CarPhysics();
  const high = new CarPhysics();
  high.gear = 6;
  for (let i = 0; i < 60; i++) {
    low.update(DT, coast);
    high.update(DT, coast);
  }
  assert.ok(low.speedKmh > high.speedKmh * 1.5);
});

test('física: reduzir marcha acima do teto mantém velocidade; freio reduz; marcha limitada 1..6', () => {
  const car = new CarPhysics();
  car.gear = 5;
  car.speedKmh = 150;
  car.update(DT, { ...coast, shift: -1 }); // 4ª, teto 135
  car.update(DT, coast);
  assert.equal(car.speedKmh, 150);
  car.update(DT, { braking: true, brakeFactor: 1, shift: 0 });
  assert.ok(car.speedKmh < 150);
  for (let i = 0; i < 10; i++) car.update(DT, { ...coast, shift: +1 });
  assert.equal(car.gear, 6);
  for (let i = 0; i < 10; i++) car.update(DT, { ...coast, shift: -1 });
  assert.equal(car.gear, 1);
});

test('grama: teto cai pela metade e a velocidade desce até ele', () => {
  const car = new CarPhysics();
  car.gear = 4; // teto 135 → 67.5 na grama
  car.speedKmh = 130;
  for (let i = 0; i < 600; i++) car.update(DT, coast, { offTrack: true });
  assert.equal(car.ceilingKmh, 67.5);
  assert.ok(car.speedKmh < 70 && car.speedKmh > 66);
  for (let i = 0; i < 60; i++) car.update(DT, coast, { offTrack: false });
  assert.ok(car.speedKmh > 70); // voltou pra pista, volta a acelerar
});

test('colisão com árvore: detecta, empurra pra fora e recua; longe não bate', () => {
  const trees = [{ x: 0, z: 10, r: 0.6 }];
  const far = { x: 0, z: 0, heading: 0 };
  assert.equal(resolveTreeCollision(far, trees, 1.6), false);
  const state = { x: 0, z: 8.5, heading: 0 }; // indo em +z, encostou no tronco
  assert.equal(resolveTreeCollision(state, trees, 1.6), true);
  assert.ok(Math.hypot(state.x, state.z - 10) > 2.2 + 1); // fora do tronco + recuo
  assert.ok(state.z < 8.5);
  assert.equal(resolveTreeCollision(state, trees, 1.6), false);
});

test('volta: checkpoints em ordem, pular um não conta, melhor volta registrada', () => {
  const cps = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }, { x: 0, z: 100 }];
  const lt = new LapTimer(cps, 10);
  assert.equal(lt.update(1, 0, 0), null); // largada no ponto 0 não fecha volta
  assert.equal(lt.update(1, 100, 100), null); // pulou o checkpoint 1
  assert.equal(lt.update(1, 100, 0).type, 'checkpoint');
  assert.equal(lt.update(1, 100, 100).index, 2);
  assert.equal(lt.update(1, 0, 0), null); // ainda falta o 3
  assert.equal(lt.update(1, 0, 100).index, 3);
  const lap = lt.update(1, 0, 0);
  assert.deepEqual(lap, { type: 'lap', lapTime: 7, isBest: true });
  assert.equal(lt.lap, 2);
  lt.update(1, 100, 0); lt.update(1, 100, 100); lt.update(1, 0, 100);
  const slower = lt.update(20, 0, 0);
  assert.equal(slower.isBest, false);
  assert.equal(lt.best, 7);
  assert.equal(formatLapTime(83.4567), '1:23.457');
});
