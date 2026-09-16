import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Race, AiDriver, Championship, OPPONENTS, RACE_LAPS, COUNTDOWN_S, pointsFor, paceSpeedKmh,
} from '../src/race.js';
import { TRACKS } from '../src/tracks.js';

const DT = 1 / 60;
// pista sintética: 1 km, reta (curvatura 0) com um trecho de curva fechada
const straight = { length: 1000, curvature: new Array(100).fill(0) };
const mixed = {
  length: 1000,
  curvature: Array.from({ length: 100 }, (_, i) => (i >= 40 && i < 60 ? 0.02 : 0)),
};

function run(race, seconds, playerSpeedKmh, track = straight) {
  let u = race.playerStartU;
  let lap = 1;
  let crossedStart = false; // como o LapTimer: cruzar a linha na largada não conta volta
  let snap;
  for (let t = 0; t < seconds; t += DT) {
    if (race.state === 'running') {
      u += (playerSpeedKmh / 3.6) * DT / track.length;
      if (u >= 1) {
        u -= 1;
        if (crossedStart) lap += 1;
        crossedStart = true;
      }
    }
    snap = race.update(DT, { lap, u });
    if (snap.state === 'done') break;
  }
  return snap;
}

test('curva fechada reduz a velocidade alvo do adversário', () => {
  const fast = paceSpeedKmh(mixed.curvature, 0.1, 1);
  const slow = paceSpeedKmh(mixed.curvature, 0.5, 1);
  assert.ok(fast > 200 && slow < 110 && slow > 40);
  assert.ok(paceSpeedKmh(mixed.curvature, 0.1, 1.1) > fast);
});

test('adversário anda, completa voltas e termina a corrida', () => {
  const ai = new AiDriver(OPPONENTS[0], straight, 0);
  let t = 0;
  for (let i = 0; i < 60 * 300 && !ai.finished; i++) {
    t += DT;
    ai.update(DT, t, 2);
  }
  assert.equal(ai.finished, true);
  assert.equal(ai.lap, 2);
  assert.ok(ai.finishTime > 30 && ai.finishTime < 120); // ~2 km em ritmo de pista
});

test('batida derruba a velocidade do adversário', () => {
  const ai = new AiDriver(OPPONENTS[1], straight, 0);
  for (let i = 0; i < 300; i++) ai.update(DT, i * DT, 3);
  const before = ai.speedKmh;
  ai.bump();
  assert.ok(ai.speedKmh < before * 0.6);
});

test('largada: contagem trava a corrida e o jogador sai em último', () => {
  const race = new Race({ track: straight });
  const s0 = race.update(DT, { lap: 1, u: 0 });
  assert.equal(s0.state, 'countdown');
  assert.ok(s0.countdown > COUNTDOWN_S - 0.1);
  assert.equal(s0.order.at(-1).isPlayer, true);
  assert.ok(race.drivers.every((d) => d.speedKmh === 0));
  const s1 = run(race, COUNTDOWN_S + 0.5, 0);
  assert.equal(s1.state, 'running');
  assert.ok(race.drivers.some((d) => d.speedKmh > 0));
});

test('largar no grid não dá volta de graça pra ninguém', () => {
  const race = new Race({ track: straight });
  const snap = run(race, 8, 60);
  assert.ok(race.drivers.every((d) => d.lap === 1), 'adversário ganhou volta na largada');
  assert.ok(snap.order.every((o) => o.lap === 1));
  // jogador larga atrás da linha e continua atrás dos adversários
  assert.equal(snap.playerPosition, 4);
});

test('jogador rápido passa todo mundo e vence; lento termina atrás', () => {
  const win = run(new Race({ track: straight }), 600, 260);
  assert.equal(win.state, 'done');
  assert.equal(win.playerPosition, 1);
  assert.equal(win.order[0].isPlayer, true);
  assert.equal(win.order[0].lap, RACE_LAPS);

  const race = new Race({ track: straight });
  const slow = run(race, 60, 40);
  assert.ok(slow.playerPosition > 1);
});

test('classificação usa volta + trecho da volta', () => {
  const race = new Race({ track: straight });
  run(race, COUNTDOWN_S + 0.1, 0);
  const snap = race.update(DT, { lap: 3, u: 0.5 });
  assert.equal(snap.order[0].isPlayer, true); // muito à frente dos adversários
  assert.equal(snap.playerPosition, 1);
});

test('pontos por posição', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(pointsFor), [10, 7, 5, 3, 0]);
});

test('campeonato: sequência de pistas, tabela e desempate por melhor colocação', () => {
  const ids = TRACKS.map((t) => t.id);
  assert.equal(ids.length, 4);
  const c = new Championship(ids);
  assert.equal(c.currentTrackId, 'lago');
  assert.equal(c.done, false);

  c.addResult('lago', ['Você', 'Vieira', 'Prado', 'Nunes']);
  assert.equal(c.currentTrackId, 'reta-grande');
  c.addResult('reta-grande', ['Vieira', 'Você', 'Nunes', 'Prado']);
  c.addResult('serra', ['Vieira', 'Prado', 'Você', 'Nunes']);
  c.addResult('anel', ['Você', 'Vieira', 'Prado', 'Nunes']);
  assert.equal(c.done, true);
  assert.equal(c.currentTrackId, null);

  const table = c.table();
  assert.equal(table.length, 4);
  assert.equal(table[0].name, 'Vieira'); // 7+10+10+7 = 34
  assert.equal(table[0].points, 34);
  assert.equal(table[0].wins, 2);
  assert.equal(table[1].name, 'Você'); // 10+7+5+10 = 32
  assert.equal(table[1].points, 32);
  assert.equal(table[1].best, 1);
  assert.deepEqual(table.map((r) => r.name).slice(2), ['Prado', 'Nunes']);

  // salvar e continuar de onde parou
  const resumed = new Championship(ids, JSON.parse(JSON.stringify(c.toJSON())));
  assert.equal(resumed.raceIndex, 4);
  assert.deepEqual(resumed.table(), table);
});

test('pistas têm ids únicos e pontos suficientes', () => {
  const ids = new Set(TRACKS.map((t) => t.id));
  assert.equal(ids.size, TRACKS.length);
  for (const t of TRACKS) {
    assert.ok(t.points.length >= 8, `${t.id} precisa de traçado`);
    assert.ok(t.name && t.description);
  }
});
