import {
  CONFIG, GestureInterpreter, CarPhysics, LapTimer, isValidCalibration, formatLapTime,
} from './logic.js';
import { createWorld, trackOutline } from './scene.js';
import { projectTrack } from './map.js';
import { Sound } from './sound.js';
import { TRACKS, trackById } from './tracks.js';
import { Race, Championship, OPPONENTS, RACE_LAPS, pointsFor } from './race.js';

const $ = (id) => document.getElementById(id);
const KEYS = {
  calib: 'volante.calibracao.v2', // medidas brutas {open, closed}
  view: 'volante.camera',
  settings: 'volante.ajustes',
  champ: 'volante.campeonato',
  best: (trackId) => `volante.melhorVolta.${trackId}`,
};

const world = createWorld($('game'));
const gestures = new GestureInterpreter();
const car = new CarPhysics();
const sound = new Sound();

let source = null; // 'camera' | 'keyboard'
let tracker = null;
let drawDebug = null;
let lastFrame = null;
let lastMs = performance.now();
let offTrack = false;

let screen = 'start'; // 'start' | 'menu' | 'tracks' | 'results' | 'ajustes' | null (correndo)
let mode = 'practice'; // 'champ' | 'single' | 'practice'
let track = null; // definição da pista atual
let trackInfo = null;
let race = null; // null no treino livre
let laps = null;
let minimap = null; // projeção da pista atual pro minimapa
let championship = new Championship(TRACKS.map((t) => t.id), loadJson(KEYS.champ));

loadCalibration();
// pista de fundo pros menus (a corrida recarrega a pista escolhida)
world.loadTrack(TRACKS[0], []);
world.placePlayer(0);
try {
  if (localStorage.getItem(KEYS.view) === 'chase') world.setView('chase');
} catch {}

// ---------------------------------------------------------------------------
// Ajustes (painel com sliders)

const SETTINGS = [
  {
    key: 'brakeStart', label: 'Freio começa com a mão fechada em', min: 50, max: 92, step: 1, unit: '%',
    hint: 'Se o freio dispara só de segurar o volante, aumente.',
    get: () => Math.round(CONFIG.hand.brakeStart * 100),
    set: (v) => { CONFIG.hand.brakeStart = Math.min(v, CONFIG.hand.fist * 100 - 5) / 100; },
  },
  {
    key: 'fist', label: 'Punho (troca de marcha) a partir de', min: 70, max: 99, step: 1, unit: '%',
    hint: 'Se o punho fechado não é reconhecido, diminua.',
    get: () => Math.round(CONFIG.hand.fist * 100),
    set: (v) => { CONFIG.hand.fist = Math.max(v, CONFIG.hand.brakeStart * 100 + 5) / 100; },
  },
  {
    key: 'brakeForce', label: 'Força do freio', min: 30, max: 120, step: 5, unit: ' km/h por segundo',
    hint: 'Quanto o carro perde por segundo com o punho totalmente fechado.',
    get: () => CONFIG.brake.maxDecelKmhPerS,
    set: (v) => { CONFIG.brake.maxDecelKmhPerS = v; },
  },
  {
    key: 'steerMax', label: 'Inclinação das mãos para esterço total', min: 20, max: 70, step: 1, unit: '°',
    hint: 'Menor = mais sensível: você vira mais com menos movimento.',
    get: () => CONFIG.steer.maxDeg,
    set: (v) => { CONFIG.steer.maxDeg = v; },
  },
  {
    key: 'steerSmooth', label: 'Suavização do volante', min: 2, max: 30, step: 1, unit: ' centésimos',
    hint: 'Maior = mais suave e mais lento pra responder.',
    get: () => Math.round(CONFIG.steer.smoothingTau * 100),
    set: (v) => { CONFIG.steer.smoothingTau = v / 100; },
  },
  {
    key: 'seat', label: 'Altura do banco', min: -12, max: 20, step: 1, unit: ' cm',
    hint: 'Mais alto = enxerga mais pista por cima do volante.',
    get: () => Math.round(world.getSeatOffset() * 100),
    set: (v) => world.setSeatOffset(v / 100),
  },
  {
    key: 'volume', label: 'Volume', min: 0, max: 100, step: 5, unit: '%',
    hint: '',
    get: () => Math.round(sound.volume * 100),
    set: (v) => sound.setVolume(v / 100),
  },
];

function buildSettingsUi() {
  const list = $('ajustes-list');
  list.innerHTML = '';
  for (const s of SETTINGS) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="row"><label for="set-${s.key}">${s.label}</label>
        <span class="val" id="val-${s.key}"></span></div>
      <input type="range" id="set-${s.key}" min="${s.min}" max="${s.max}" step="${s.step}">
      <p class="hint">${s.hint}</p>`;
    list.appendChild(wrap);
    const input = wrap.querySelector('input');
    input.value = s.get();
    input.oninput = () => {
      s.set(Number(input.value));
      input.value = s.get();
      $(`val-${s.key}`).textContent = `${s.get()}${s.unit}`;
      saveSettings();
    };
    $(`val-${s.key}`).textContent = `${s.get()}${s.unit}`;
  }
}

function saveSettings() {
  const data = Object.fromEntries(SETTINGS.map((s) => [s.key, s.get()]));
  try { localStorage.setItem(KEYS.settings, JSON.stringify(data)); } catch {}
}

function loadSettings() {
  const data = loadJson(KEYS.settings);
  if (!data) return;
  for (const s of SETTINGS) if (typeof data[s.key] === 'number') s.set(data[s.key]);
}

function refreshSettingsUi() {
  for (const s of SETTINGS) {
    const input = $(`set-${s.key}`);
    if (input) input.value = s.get();
    if ($(`val-${s.key}`)) $(`val-${s.key}`).textContent = `${s.get()}${s.unit}`;
  }
}

$('ajustes-close').onclick = () => showScreen(race || laps ? null : 'menu');
$('ajustes-reset').onclick = () => {
  CONFIG.hand.brakeStart = 0.7;
  CONFIG.hand.fist = 0.88;
  CONFIG.brake.maxDecelKmhPerS = 70;
  CONFIG.steer.maxDeg = 45;
  CONFIG.steer.smoothingTau = 0.08;
  world.setSeatOffset(0);
  sound.setVolume(0.6);
  saveSettings();
  refreshSettingsUi();
  toast('Ajustes restaurados');
};
$('ajustes-calib').onclick = () => {
  if (source !== 'camera') return toast('Só no modo câmera');
  showScreen(null);
  calib = { phase: 'open', until: performance.now() + 2500, open: [], closed: [] };
};

// ---------------------------------------------------------------------------
// Telas

function showScreen(name) {
  screen = name;
  for (const id of ['start', 'menu', 'tracks', 'prerace', 'results', 'ajustes']) $(id).hidden = id !== name;
  $('hud').hidden = !(name === null && source);
  $('debug').hidden = !(source === 'camera' && name === null);
}

$('start-keyboard').onclick = () => beginInput('keyboard');
$('start-camera').onclick = async () => {
  sound.start(); // precisa nascer do clique, antes do await
  $('start-status').textContent = 'Abrindo câmera e carregando modelo…';
  try {
    const mod = await import('./hands.js');
    drawDebug = mod.drawDebug;
    tracker = new mod.HandTracker($('cam'));
    await tracker.init();
    const c = $('cam-overlay');
    c.width = $('cam').videoWidth;
    c.height = $('cam').videoHeight;
    beginInput('camera');
  } catch (err) {
    console.error(err);
    $('start-status').textContent = `Não deu pra usar a câmera: ${err.message}. Tente o modo teclado.`;
  }
};

function beginInput(kind) {
  sound.start();
  source = kind;
  $('keyboard-help').hidden = kind !== 'keyboard';
  buildSettingsUi();
  loadSettings();
  refreshSettingsUi();
  openMenu();
}

function openMenu() {
  const table = championship.table();
  $('champ-status').textContent = championship.done
    ? `Campeonato concluído — campeão: ${table[0]?.name ?? '—'}`
    : `Corrida ${championship.raceIndex + 1} de ${TRACKS.length} · ${trackById(championship.currentTrackId).name}`;
  $('btn-champ').textContent = championship.done ? 'Ver tabela' : (championship.raceIndex ? 'Continuar' : 'Começar');
  $('btn-champ').disabled = championship.done;
  $('champ-table-wrap').hidden = table.length === 0;
  fillTable($('champ-table'), table.map((r, i) => [i + 1, r.name, r.wins, r.points]), 1);
  showScreen('menu');
}

$('btn-champ').onclick = () => openPreRace(trackById(championship.currentTrackId), 'champ');
$('btn-champ-reset').onclick = () => {
  championship = new Championship(TRACKS.map((t) => t.id));
  try { localStorage.removeItem(KEYS.champ); } catch {}
  openMenu();
};
$('btn-single').onclick = () => openTrackPicker('single');
$('btn-practice').onclick = () => openTrackPicker('practice');
$('btn-ajustes').onclick = () => showScreen('ajustes');
$('tracks-back').onclick = () => openMenu();
$('results-menu').onclick = () => openMenu();
$('results-next').onclick = () => {
  if (mode === 'champ' && !championship.done) openPreRace(trackById(championship.currentTrackId), 'champ');
  else if (mode === 'champ') openMenu();
  else openPreRace(track, mode);
};

function openTrackPicker(kind) {
  mode = kind;
  $('tracks-title').textContent = kind === 'practice' ? 'Treino livre' : 'Corrida avulsa';
  const list = $('track-list');
  list.innerHTML = '';
  for (const t of TRACKS) {
    const best = loadNumber(KEYS.best(t.id));
    const item = document.createElement('div');
    item.className = 'menu-item';
    item.innerHTML = `${mapSvg(t, 54, 'track-thumb')}
      <div style="flex:1"><div class="t">${t.name}</div><div class="d">${t.description}</div>
      <div class="d">melhor volta: ${best ? formatLapTime(best) : '—'}</div></div>`;
    const btn = document.createElement('button');
    btn.textContent = 'Escolher';
    btn.onclick = () => openPreRace(t, kind);
    item.appendChild(btn);
    list.appendChild(item);
  }
  showScreen('tracks');
}

/** Desenho do traçado como SVG (miniaturas do menu e mapa da prévia). */
function mapSvg(def, size, className = '') {
  const { path } = projectTrack(trackOutline(def), size, size * 0.08);
  return `<svg class="${className}" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <path d="${path}" fill="none" stroke="#3b3f45" stroke-width="${size * 0.075}" stroke-linejoin="round"/>
    <path d="${path}" fill="none" stroke="#8a93a0" stroke-width="${size * 0.012}" stroke-dasharray="3 5"/>
  </svg>`;
}

// ---------------------------------------------------------------------------
// Prévia da pista (mapa antes de largar)

let pending = null; // { def, kind }

function openPreRace(def, kind) {
  pending = { def, kind };
  mode = kind;
  const outline = trackOutline(def);
  const { path, project } = projectTrack(outline, 220, 16);
  const [sx, sy] = project(outline[0].x, outline[0].z);
  $('prerace-map').innerHTML = `
    <path d="${path}" fill="none" stroke="#3b3f45" stroke-width="15" stroke-linejoin="round"/>
    <path d="${path}" fill="none" stroke="#f5f5f5" stroke-width="1.5" stroke-dasharray="5 7"/>
    <circle cx="${sx}" cy="${sy}" r="6" fill="#ffd400"/>
    <text x="${sx + 10}" y="${sy + 4}" fill="#ffd400" font-size="11" font-family="system-ui">largada</text>`;
  $('prerace-name').textContent = def.name;
  $('prerace-desc').textContent = def.description;
  $('prerace-race').textContent = kind === 'champ'
    ? `${championship.raceIndex + 1} de ${TRACKS.length} do campeonato`
    : (kind === 'practice' ? 'Treino livre' : 'Corrida avulsa');
  $('prerace-laps').textContent = kind === 'practice' ? 'livre' : RACE_LAPS;
  $('prerace-length').textContent = `${Math.round(lengthOf(outline))} m`;
  const best = loadNumber(KEYS.best(def.id));
  $('prerace-best').textContent = best ? formatLapTime(best) : '—';
  $('prerace-rivals').textContent = kind === 'practice' ? 'nenhum' : OPPONENTS.map((o) => o.name).join(', ');
  showScreen('prerace');
}

function lengthOf(outline) {
  let sum = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    sum += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return sum;
}

$('prerace-go').onclick = () => startRace(pending.def, pending.kind);
$('prerace-back').onclick = () => (pending?.kind === 'champ' ? openMenu() : openTrackPicker(pending.kind));

// ---------------------------------------------------------------------------
// Corrida

function startRace(def, kind) {
  mode = kind;
  track = def;
  const opponents = kind === 'practice' ? [] : OPPONENTS;
  trackInfo = world.loadTrack(def, opponents);
  const canvas = $('minimap-canvas');
  minimap = projectTrack(trackInfo.outline, canvas.width, 22);
  laps = new LapTimer(trackInfo.checkpoints, trackInfo.checkpointRadius, loadNumber(KEYS.best(def.id)));
  race = kind === 'practice' ? null : new Race({ track: trackInfo });
  world.placePlayer(race ? race.playerStartU : 0, 0);
  car.speedKmh = 0;
  car.gear = CONFIG.gears.initial;
  gestures.steerDeg = 0;
  $('standings').hidden = !race;
  $('position').hidden = !race;
  $('debug').classList.toggle('with-standings', !!race);
  showScreen(null);
  toast(def.name);
  lastMs = performance.now();
}

function finishRace(snapshot) {
  const order = snapshot.order.map((o) => o.name);
  const isChamp = mode === 'champ';
  if (isChamp) {
    championship.addResult(track.id, order);
    try { localStorage.setItem(KEYS.champ, JSON.stringify(championship.toJSON())); } catch {}
  }
  const rows = snapshot.order.map((o, i) => [
    i + 1,
    o.name,
    o.finished ? formatLapTime(o.finishTime) : '—',
    isChamp ? pointsFor(i + 1) : '—',
  ]);
  const myPos = snapshot.playerPosition;
  $('results-title').textContent = myPos === 1 ? `Vitória em ${track.name}!` : `${myPos}º lugar em ${track.name}`;
  fillTable($('results-table'), rows, snapshot.order.findIndex((o) => o.isPlayer) + 1);
  $('results-champ').hidden = !isChamp;
  if (isChamp) {
    const table = championship.table();
    fillTable($('results-champ-table'), table.map((r, i) => [i + 1, r.name, r.wins, r.points]),
      table.findIndex((r) => r.name === 'Você') + 1);
  }
  $('results-next').textContent = isChamp
    ? (championship.done ? 'Ver campeonato' : `Próxima: ${trackById(championship.currentTrackId).name}`)
    : 'Correr de novo';
  race = null;
  laps = null;
  showScreen('results');
}

function fillTable(tbody, rows, highlightPos) {
  tbody.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    if (r[0] === highlightPos) tr.className = 'me';
    tr.innerHTML = `<td>${r[0]}</td><td>${r[1]}</td><td class="num">${r[2]}</td><td class="num">${r[3]}</td>`;
    tbody.appendChild(tr);
  }
}

// ---------------------------------------------------------------------------
// Entrada por teclado (simula as mãos pra testar sem câmera)

const keys = new Set();
let keyAngle = 0;
addEventListener('keydown', (e) => {
  if (e.code === 'KeyA' && !e.repeat) return showScreen(screen === 'ajustes' ? (laps ? null : 'menu') : 'ajustes');
  if (e.code === 'Escape' && !e.repeat) return openMenu();
  keys.add(e.code);
  if (e.code === 'KeyR') resetCar();
  if (e.code === 'KeyM') toast(sound.toggleMute() ? 'Som desligado' : 'Som ligado');
  if (e.code === 'KeyC' && !e.repeat) toggleView();
  if (e.code === 'ArrowUp') adjustSeat(+0.02);
  if (e.code === 'ArrowDown') adjustSeat(-0.02);
});
addEventListener('keyup', (e) => keys.delete(e.code));

function keyboardHand(fistKey, partialKey) {
  if (keys.has(fistKey)) return ['closed', 1];
  if (keys.has(partialKey)) return ['partial', 0.8];
  return ['open', 0.2];
}

function keyboardFrame(dt) {
  const target = (keys.has('ArrowRight') ? 30 : 0) - (keys.has('ArrowLeft') ? 30 : 0);
  keyAngle += (target - keyAngle) * (1 - Math.exp(-dt * 8));
  if (keys.has('KeyH')) return { left: null, right: 'open', angleDeg: null, hands: [] };
  const [left, leftClosure] = keyboardHand('KeyQ', 'KeyZ');
  const [right, rightClosure] = keyboardHand('KeyP', 'KeyL');
  return { left, right, leftClosure, rightClosure, angleDeg: keyAngle, hands: [] };
}

function resetCar() {
  car.speedKmh = 0;
  car.gear = CONFIG.gears.initial;
}

function toggleView() {
  const next = world.getView() === 'cockpit' ? 'chase' : 'cockpit';
  world.setView(next);
  try { localStorage.setItem(KEYS.view, next); } catch {}
  toast(next === 'cockpit' ? 'Visão de dentro' : 'Visão de fora');
}

function adjustSeat(delta) {
  if (world.getView() !== 'cockpit') return;
  const v = world.setSeatOffset(world.getSeatOffset() + delta);
  saveSettings();
  refreshSettingsUi();
  toast(`Banco ${v >= 0 ? '+' : ''}${Math.round(v * 100)} cm`);
}

// ---------------------------------------------------------------------------
// Calibração: mãos abertas, depois punho

let calib = null;

function updateCalibration(now, frame) {
  const remaining = Math.ceil((calib.until - now) / 1000);
  const settled = now > calib.until - 1900; // ignora o começo da fase (mão em transição)
  if (settled && frame.hands.length === 2) for (const h of frame.hands) calib[calib.phase].push(h.openness);
  $('calib-msg').hidden = false;
  $('calib-msg').textContent = calib.phase === 'open'
    ? `Segure o volante com as duas mãos abertas… ${remaining}`
    : `Agora feche as duas mãos por completo (punho)… ${remaining}`;
  if (now < calib.until) return;
  if (calib.phase === 'open') {
    calib.phase = 'closed';
    calib.until = now + 2500;
    return;
  }
  const sample = { open: median(calib.open), closed: median(calib.closed) };
  if (isValidCalibration(sample)) {
    CONFIG.hand.calib = sample;
    try { localStorage.setItem(KEYS.calib, JSON.stringify(sample)); } catch {}
    $('calib-msg').textContent = 'Calibrado!';
  } else {
    $('calib-msg').textContent = 'Calibração falhou (mãos não detectadas ou pouca diferença). Tente de novo.';
  }
  calib = null;
  setTimeout(() => { if (!calib) $('calib-msg').hidden = true; }, 2000);
}

function median(arr) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function loadCalibration() {
  const s = loadJson(KEYS.calib);
  if (isValidCalibration(s)) CONFIG.hand.calib = { open: s.open, closed: s.closed };
}

function loadJson(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function loadNumber(key) {
  const v = Number(localStorage.getItem(key));
  return v > 0 ? v : null;
}

// ---------------------------------------------------------------------------
// Loop

const MODE_LABEL = {
  steer: 'Volante',
  brake: 'Freando',
  'shift-pending': 'Trocando…',
  shifted: 'Marcha trocada',
  hold: 'Reabra as mãos',
  lost: 'Mão fora do quadro',
};

function loop(now) {
  const dt = Math.min((now - lastMs) / 1000, CONFIG.maxDt);
  lastMs = now;

  let out = {
    mode: 'steer', steerDeg: gestures.steerDeg, wheelDeg: gestures.wheelDeg, braking: false, brakeFactor: 0, shift: 0,
  };
  // o mundo só anda com o jogo na tela, fora da calibração e da contagem
  const racing = screen === null && !!laps;
  const frozen = !!race && race.state === 'countdown';
  let simDt = 0;

  if (source) {
    const frame = source === 'camera' ? tracker.poll(now) : keyboardFrame(dt);
    lastFrame = frame;
    if (calib) {
      updateCalibration(now, frame);
    } else if (racing) {
      out = gestures.update(frame, now, dt);
      if (!frozen) {
        simDt = dt;
        car.update(dt, out, { offTrack });
        if (out.shift) {
          flashGear();
          sound.shift();
        }
      }
    }
  }

  const aiStates = race ? race.drivers.map((d) => ({ u: d.u, lane: d.lane })) : [];
  const res = world.step(simDt, car.speedKmh, out.steerDeg, CONFIG.steer.maxDeg, cockpitInfo(out), aiStates);
  if (!res) return requestAnimationFrame(loop);
  offTrack = res.offTrack;

  if (res.collided && racing) {
    if (car.speedKmh > 5) {
      sound.crash();
      toast('Bateu!');
    }
    car.speedKmh = 0;
  }
  for (const i of res.bumpedAi) {
    if (!race) break;
    race.drivers[i].bump();
    if (car.speedKmh > 30) sound.crash();
    car.speedKmh *= 0.7;
  }

  if (simDt > 0) {
    const ev = laps.update(simDt, res.x, res.z);
    if (ev?.type === 'checkpoint') {
      sound.chime();
    } else if (ev?.type === 'lap') {
      sound.chime(true);
      if (ev.isBest) {
        try { localStorage.setItem(KEYS.best(track.id), String(ev.lapTime)); } catch {}
        toast(`Melhor volta! ${formatLapTime(ev.lapTime)}`);
      } else {
        toast(`Volta ${formatLapTime(ev.lapTime)}`);
      }
    }
  }

  let snapshot = null;
  if (race && screen === null) {
    snapshot = race.update(dt, { lap: laps.lap, u: res.u });
    if (snapshot.state === 'done') finishRace(snapshot);
  }

  sound.updateEngine(car.speedKmh, car.ceilingKmh, car.gear);
  if (screen === null && source) renderHud(out, snapshot, res);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// acesso de depuração (só com ?debug=1 na URL): inspecionar/forçar estados no console
if (new URLSearchParams(location.search).has('debug')) {
  window.__jogo = {
    car, world, CONFIG, sound, startRace, TRACKS,
    get race() { return race; },
    get laps() { return laps; },
    get championship() { return championship; },
    get screen() { return screen; },
  };
}

function cockpitInfo(out) {
  return {
    wheelDeg: out.wheelDeg,
    hands: { left: handInfo(lastFrame, 'left'), right: handInfo(lastFrame, 'right') },
    shift: out.shift,
    braking: out.braking,
    brakeFactor: out.brakeFactor,
    speedKmh: car.speedKmh,
    gear: car.gear,
    ceilingKmh: car.ceilingKmh,
    offTrack,
  };
}

function handInfo(frame, side) {
  if (!frame) return { state: 'open', closure: 0.1 }; // antes de começar, luvas abertas no volante
  const state = frame[side];
  return state ? { state, closure: frame[`${side}Closure`] ?? 0 } : null;
}

const HAND_LABEL = { open: 'aberta', partial: 'freio', closed: 'punho' };

/** Minimapa: traçado fixo com norte pra cima, seu carro em amarelo e os rivais nas cores deles. */
function drawMinimap(res) {
  if (!minimap) return;
  const canvas = $('minimap-canvas');
  const ctx = canvas.getContext('2d');
  const { width: W } = canvas;
  ctx.clearRect(0, 0, W, W);

  const road = new Path2D(minimap.path);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#4a4f57';
  ctx.lineWidth = 16;
  ctx.stroke(road);
  ctx.strokeStyle = '#8a93a0';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 10]);
  ctx.stroke(road);
  ctx.setLineDash([]);

  // largada
  const [sx, sy] = minimap.project(trackInfo.outline[0].x, trackInfo.outline[0].z);
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(sx - 7, sy - 7, 14, 14);

  const dot = (x, z, color, r) => {
    const [px, py] = minimap.project(x, z);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#05070a';
    ctx.stroke();
  };
  res.aiPositions.forEach((p, i) => dot(p.x, p.z, hex(OPPONENTS[i]?.color ?? 0xffffff), 9));
  dot(res.x, res.z, '#ffd400', 11);
}

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

function renderHud(out, snapshot, res) {
  $('dash').hidden = world.getView() === 'cockpit';
  $('speed').textContent = Math.round(car.speedKmh);
  $('gear').textContent = car.gear;
  $('ceiling').textContent = offTrack ? `teto ${car.ceilingKmh} km/h (grama)` : `teto ${car.ceilingKmh} km/h`;
  $('rpm-fill').style.width = `${Math.min(100, (car.speedKmh / car.ceilingKmh) * 100)}%`;
  $('brake-fill').style.width = `${out.brakeFactor * 100}%`;
  $('wheel').style.transform = `rotate(${out.steerDeg}deg)`;
  $('mode').textContent = MODE_LABEL[out.mode];
  $('mode').dataset.mode = out.mode;
  $('offtrack').hidden = !offTrack;

  const n = laps ? laps.checkpoints.length : 6;
  $('lap-header').textContent = race ? `Volta ${Math.min(laps.lap, RACE_LAPS)}/${RACE_LAPS}` : `Volta ${laps?.lap ?? 1}`;
  $('lap-current').textContent = formatLapTime(laps?.current ?? 0);
  $('lap-best').textContent = formatLapTime(laps?.best);
  $('lap-last').textContent = formatLapTime(laps?.last);
  $('lap-cp').textContent = laps?.next === 0 ? 'rumo à chegada' : `${(laps?.next ?? 1) - 1}/${n - 1}`;

  if (snapshot) {
    $('countdown').hidden = snapshot.state !== 'countdown';
    $('countdown').textContent = snapshot.countdown > 0.2 ? Math.ceil(snapshot.countdown - 0.2) : 'VAI!';
    $('pos-num').textContent = snapshot.playerPosition;
    $('standings').innerHTML = snapshot.order.map((o) => `
      <div class="row${o.isPlayer ? ' me' : ''}"><span class="pos">${o.position}</span>
      <span style="flex:1">${o.name}</span><span class="unit">V${o.lap}</span></div>`).join('');
  } else {
    $('countdown').hidden = true;
  }

  drawMinimap(res);

  if (source === 'camera' && lastFrame) {
    drawDebug($('cam-overlay').getContext('2d'), lastFrame);
    const fmt = (h, s) => (h ? `${Math.round(h.closure * 100)}% ${HAND_LABEL[s]}` : '—');
    $('dbg-left').textContent = fmt(lastFrame.leftHand, lastFrame.left);
    $('dbg-right').textContent = fmt(lastFrame.rightHand, lastFrame.right);
    $('dbg-left').dataset.state = lastFrame.left ?? '';
    $('dbg-right').dataset.state = lastFrame.right ?? '';
    $('dbg-angle').textContent = lastFrame.angleDeg == null ? '—' : `${lastFrame.angleDeg.toFixed(0)}°`;
    const h = CONFIG.hand;
    $('dbg-thr').textContent = `freio ≥ ${Math.round(h.brakeStart * 100)}% · punho ≥ ${Math.round(h.fist * 100)}%`;
  }
}

let gearTimer = 0;
function flashGear() {
  const el = $('gear-box');
  el.classList.add('flash');
  clearTimeout(gearTimer);
  gearTimer = setTimeout(() => el.classList.remove('flash'), 350);
}

let toastTimer = 0;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}
