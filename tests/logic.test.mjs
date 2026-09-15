import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG, GestureInterpreter, CarPhysics, classifyHand, shapeSteer,
  wheelAngleDeg, thresholdsFromCalibration, handOpenness,
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

const O = 'open', C = 'closed';
const DT = 1 / 60;

function run(gi, frames, startMs = 0) {
  let t = startMs;
  const outs = [];
  for (const [left, right, ms, angleDeg = 0] of frames) {
    const n = Math.round(ms / (DT * 1000));
    for (let i = 0; i < n; i++) {
      t += DT * 1000;
      outs.push(gi.update({ left, right, angleDeg }, t, DT));
    }
  }
  return outs;
}
const shifts = (outs) => outs.filter((o) => o.shift !== 0).map((o) => o.shift);

test('mão direita fechada por 200ms sobe uma marcha, uma vez só', () => {
  const gi = new GestureInterpreter();
  const outs = run(gi, [[O, O, 100], [O, C, 1000]]);
  assert.deepEqual(shifts(outs), [+1]);
});

test('mão esquerda fechada desce marcha', () => {
  const gi = new GestureInterpreter();
  assert.deepEqual(shifts(run(gi, [[O, O, 100], [C, O, 300]])), [-1]);
});

test('reabrir a mão rearma a troca', () => {
  const gi = new GestureInterpreter();
  const outs = run(gi, [[O, O, 50], [O, C, 300], [O, O, 50], [O, C, 300]]);
  assert.deepEqual(shifts(outs), [+1, +1]);
});

test('fechar uma mão rapidamente antes da outra (entrando no freio) não troca marcha', () => {
  const gi = new GestureInterpreter();
  const outs = run(gi, [[O, O, 100], [O, C, 150], [C, C, 500]]);
  assert.deepEqual(shifts(outs), []);
  assert.equal(outs.at(-1).braking, true);
});

test('soltar o freio abrindo uma mão por vez não troca marcha', () => {
  const gi = new GestureInterpreter();
  const outs = run(gi, [[O, O, 50], [C, C, 500], [O, C, 800], [O, O, 50]]);
  assert.deepEqual(shifts(outs), []);
});

test('freio progressivo: 30% no início, 100% após 1s', () => {
  const gi = new GestureInterpreter();
  const outs = run(gi, [[C, C, 1200]]);
  assert.ok(Math.abs(outs[0].brakeFactor - 0.3) < 0.02);
  assert.ok(Math.abs(outs[29].brakeFactor - 0.65) < 0.03);
  assert.equal(outs.at(-1).brakeFactor, 1);
});

test('direção só atualiza com as duas mãos abertas; trava ao fechar e ao perder mão', () => {
  const gi = new GestureInterpreter();
  const a = run(gi, [[O, O, 1000, 24]]);
  assert.ok(Math.abs(a.at(-1).steerDeg - 20) < 0.1); // 24 - zona morta 4
  const b = run(gi, [[O, C, 100, -30], [C, C, 300, -30]], 2000);
  assert.ok(b.every((o) => Math.abs(o.steerDeg - a.at(-1).steerDeg) < 1e-9));
  const c = run(gi, [[null, O, 300, -30]], 3000);
  assert.ok(c.every((o) => o.mode === 'lost' && !o.braking && o.shift === 0));
  assert.ok(Math.abs(c.at(-1).steerDeg - a.at(-1).steerDeg) < 1e-9);
});

test('histerese na classificação', () => {
  const h = { closeBelow: 0.7, openAbove: 0.85 };
  assert.equal(classifyHand(0.78, 'open', h), 'open');
  assert.equal(classifyHand(0.65, 'open', h), 'closed');
  assert.equal(classifyHand(0.78, 'closed', h), 'closed');
  assert.equal(classifyHand(0.9, 'closed', h), 'open');
});

test('ângulo do volante: mão direita mais baixa = positivo (vira pra direita)', () => {
  assert.ok(wheelAngleDeg({ x: 0, y: 0 }, { x: 10, y: 5 }) > 0);
  assert.equal(shapeSteer(3), 0);
  assert.equal(shapeSteer(-100), -CONFIG.steer.maxDeg);
});

test('calibração gera limiares perto do punho (só 100% fechada conta)', () => {
  const t = thresholdsFromCalibration(1.3, 0.5);
  assert.ok(t.closeBelow > 0.5 && t.openAbove < 1.3 && t.closeBelow < t.openAbove);
  assert.ok(t.closeBelow - 0.5 <= 0.15 * 0.8); // bem mais perto do punho que do aberto
  assert.equal(thresholdsFromCalibration(0.6, 0.55), null);
});

test('mão só fecha com os 4 dedos dobrados', () => {
  const fist = handOpenness(fakeHand([false, false, false, false]));
  const open = handOpenness(fakeHand([true, true, true, true]));
  const t = thresholdsFromCalibration(open, fist);
  assert.equal(classifyHand(fist, 'open', t), 'closed');
  for (let k = 0; k < 4; k++) {
    const oneOut = fakeHand([0, 1, 2, 3].map((i) => i === k));
    assert.equal(classifyHand(handOpenness(oneOut), 'open', t), 'open', `dedo ${k} esticado`);
  }
});

test('física: começa em 1ª, acelera até perto do teto e nunca passa', () => {
  const car = new CarPhysics();
  assert.equal(car.gear, 1);
  for (let i = 0; i < 600; i++) car.update(DT, { braking: false, brakeFactor: 0, shift: 0 });
  assert.ok(car.speedKmh > 39 && car.speedKmh <= 40);
});

test('física: sair parado em marcha alta é mais lento que em 1ª', () => {
  const low = new CarPhysics();
  const high = new CarPhysics();
  high.gear = 6;
  for (let i = 0; i < 60; i++) {
    low.update(DT, { braking: false, brakeFactor: 0, shift: 0 });
    high.update(DT, { braking: false, brakeFactor: 0, shift: 0 });
  }
  assert.ok(low.speedKmh > high.speedKmh * 1.5);
});

test('física: reduzir marcha acima do teto mantém velocidade; freio reduz; marcha limitada 1..6', () => {
  const car = new CarPhysics();
  car.gear = 5;
  car.speedKmh = 150;
  car.update(DT, { braking: false, brakeFactor: 0, shift: -1 }); // 4ª, teto 135
  car.update(DT, { braking: false, brakeFactor: 0, shift: 0 });
  assert.equal(car.speedKmh, 150);
  car.update(DT, { braking: true, brakeFactor: 1, shift: 0 });
  assert.ok(car.speedKmh < 150);
  for (let i = 0; i < 10; i++) car.update(DT, { braking: false, brakeFactor: 0, shift: +1 });
  assert.equal(car.gear, 6);
  for (let i = 0; i < 10; i++) car.update(DT, { braking: false, brakeFactor: 0, shift: -1 });
  assert.equal(car.gear, 1);
});
