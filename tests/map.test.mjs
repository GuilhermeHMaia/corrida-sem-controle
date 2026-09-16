import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectTrack, outlineOf } from '../src/map.js';

const square = [
  { x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }, { x: 0, z: 100 },
];

test('projeção cabe no quadrado com a margem pedida', () => {
  const { project } = projectTrack(square, 120, 10);
  for (const p of square) {
    const [x, y] = project(p.x, p.z);
    assert.ok(x >= 9.9 && x <= 110.1, `x fora: ${x}`);
    assert.ok(y >= 9.9 && y <= 110.1, `y fora: ${y}`);
  }
});

test('mantém a proporção e põe o norte pra cima', () => {
  const wide = [{ x: 0, z: 0 }, { x: 200, z: 0 }, { x: 200, z: 50 }, { x: 0, z: 50 }];
  const { project } = projectTrack(wide, 100, 0);
  const [x0, y0] = project(0, 0);
  const [x1, y1] = project(200, 0);
  const [, y2] = project(0, 50);
  assert.ok(Math.abs((x1 - x0) - 100) < 0.01); // largura ocupa todo o mapa
  assert.ok(Math.abs((y0 - y2) - 25) < 0.01); // altura na mesma escala
  assert.ok(y2 < y0, 'z maior deve ficar mais acima no mapa');
});

test('caminho SVG fechado com todos os pontos', () => {
  const { path } = projectTrack(square);
  assert.ok(path.startsWith('M'));
  assert.ok(path.endsWith('Z'));
  assert.equal(path.match(/L/g).length, square.length - 1);
});

test('outline reduz a quantidade de pontos mantendo o formato', () => {
  const many = Array.from({ length: 900 }, (_, i) => ({
    x: Math.cos((i / 900) * Math.PI * 2) * 100,
    z: Math.sin((i / 900) * Math.PI * 2) * 100,
  }));
  const out = outlineOf(many, 120);
  assert.ok(out.length <= 130 && out.length >= 110);
  assert.deepEqual(out[0], many[0]);
});
