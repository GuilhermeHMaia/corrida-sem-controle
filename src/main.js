import {
  CONFIG, GestureInterpreter, CarPhysics, LapTimer, isValidCalibration, formatLapTime,
} from './logic.js';
import { createWorld } from './scene.js';
import { Sound } from './sound.js';

const $ = (id) => document.getElementById(id);
// Calibração salva as medidas brutas {open, closed}, pra fórmula poder mudar sem invalidá-la.
// v2: métrica passou a ser o dedo mais aberto — calibrações antigas não servem.
const CALIB_KEY = 'volante.calibracao.v2';
const BEST_KEY = 'volante.melhorVolta';
const VIEW_KEY = 'volante.camera';

const world = createWorld($('game'));
const gestures = new GestureInterpreter();
const car = new CarPhysics();
const sound = new Sound();
const laps = new LapTimer(world.checkpoints, world.checkpointRadius, loadNumber(BEST_KEY));

let source = null; // 'camera' | 'keyboard'
let tracker = null;
let drawDebug = null;
let lastFrame = null;
let lastMs = performance.now();
let offTrack = false;

loadCalibration();
const SEAT_KEY = 'volante.banco';
try {
  if (localStorage.getItem(VIEW_KEY) === 'chase') world.setView('chase');
  world.setSeatOffset(Number(localStorage.getItem(SEAT_KEY)) || 0);
} catch {}

function adjustSeat(delta) {
  if (world.getView() !== 'cockpit') return;
  const v = world.setSeatOffset(world.getSeatOffset() + delta);
  try { localStorage.setItem(SEAT_KEY, String(v)); } catch {}
  toast(`Banco ${v >= 0 ? '+' : ''}${Math.round(v * 100)} cm`);
}

function toggleView() {
  const next = world.getView() === 'cockpit' ? 'chase' : 'cockpit';
  world.setView(next);
  try { localStorage.setItem(VIEW_KEY, next); } catch {}
  toast(next === 'cockpit' ? 'Visão de dentro' : 'Visão de fora');
}

// ---------------------------------------------------------------------------
// Entrada por teclado (simula as mãos pra testar sem câmera)

const keys = new Set();
let keyAngle = 0;
addEventListener('keydown', (e) => {
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
  const [left, leftClosure] = keyboardHand('KeyQ', 'KeyA');
  const [right, rightClosure] = keyboardHand('KeyP', 'KeyL');
  return { left, right, leftClosure, rightClosure, angleDeg: keyAngle, hands: [] };
}

// ---------------------------------------------------------------------------
// Início

$('start-keyboard').onclick = () => begin('keyboard');
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
    $('debug').hidden = false;
    begin('camera');
  } catch (err) {
    console.error(err);
    $('start-status').textContent = `Não deu pra usar a câmera: ${err.message}. Tente o modo teclado.`;
  }
};

function begin(mode) {
  sound.start();
  source = mode;
  $('start').hidden = true;
  $('hud').hidden = false;
  $('keyboard-help').hidden = mode !== 'keyboard';
  $('calibrate').hidden = mode !== 'camera';
  lastMs = performance.now();
}

function resetCar() {
  car.speedKmh = 0;
  car.gear = CONFIG.gears.initial;
}

// ---------------------------------------------------------------------------
// Calibração: mãos abertas, depois punho

let calib = null;
$('calibrate').onclick = () => {
  calib = { phase: 'open', until: performance.now() + 2500, open: [], closed: [] };
};

function updateCalibration(now, frame) {
  const remaining = Math.ceil((calib.until - now) / 1000);
  // ignora o começo da fase (mão ainda em transição)
  const settled = now > calib.until - 1900;
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
    try { localStorage.setItem(CALIB_KEY, JSON.stringify(sample)); } catch {}
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
  try {
    const s = JSON.parse(localStorage.getItem(CALIB_KEY));
    if (isValidCalibration(s)) CONFIG.hand.calib = { open: s.open, closed: s.closed };
  } catch {}
}

function loadNumber(key) {
  try {
    const v = Number(localStorage.getItem(key));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
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
  // antes do início e durante a calibração o mundo fica parado
  let simDt = 0;
  if (source) {
    const frame = source === 'camera' ? tracker.poll(now) : keyboardFrame(dt);
    lastFrame = frame;
    if (calib) {
      updateCalibration(now, frame);
    } else {
      simDt = dt;
      out = gestures.update(frame, now, dt);
      car.update(dt, out, { offTrack });
      if (out.shift) {
        flashGear();
        sound.shift();
      }
    }
  }

  const res = world.step(simDt, car.speedKmh, out.steerDeg, CONFIG.steer.maxDeg, {
    wheelDeg: out.wheelDeg,
    hands: {
      left: handInfo(lastFrame, 'left'),
      right: handInfo(lastFrame, 'right'),
    },
    shift: out.shift,
    braking: out.braking,
    brakeFactor: out.brakeFactor,
    speedKmh: car.speedKmh,
    gear: car.gear,
    ceilingKmh: car.ceilingKmh,
    offTrack,
  });
  offTrack = res.offTrack;
  if (res.collided) {
    if (car.speedKmh > 5) {
      sound.crash();
      toast('Bateu!');
    }
    car.speedKmh = 0;
  }

  if (simDt > 0) {
    const ev = laps.update(simDt, res.x, res.z);
    if (ev?.type === 'checkpoint') {
      sound.chime();
    } else if (ev?.type === 'lap') {
      sound.chime(true);
      if (ev.isBest) {
        try { localStorage.setItem(BEST_KEY, String(ev.lapTime)); } catch {}
        toast(`Nova melhor volta! ${formatLapTime(ev.lapTime)}`);
      } else {
        toast(`Volta ${formatLapTime(ev.lapTime)}`);
      }
    }
  }

  sound.updateEngine(car.speedKmh, car.ceilingKmh, car.gear);
  if (source) renderHud(out);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function handInfo(frame, side) {
  // antes de começar, luvas abertas no volante
  if (!frame) return { state: 'open', closure: 0.1 };
  const state = frame[side];
  return state ? { state, closure: frame[`${side}Closure`] ?? 0 } : null;
}

const HAND_LABEL = { open: 'aberta', partial: 'freio', closed: 'punho' };

function renderHud(out) {
  // na visão de dentro, velocidade/marcha/freio estão no display do volante
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

  const n = laps.checkpoints.length;
  $('lap-num').textContent = laps.lap;
  $('lap-current').textContent = formatLapTime(laps.current);
  $('lap-best').textContent = formatLapTime(laps.best);
  $('lap-last').textContent = formatLapTime(laps.last);
  $('lap-cp').textContent = laps.next === 0 ? 'rumo à chegada' : `${laps.next - 1}/${n - 1}`;

  if (source === 'camera' && lastFrame) {
    drawDebug($('cam-overlay').getContext('2d'), lastFrame);
    const fmt = (h, s) => (h ? `${Math.round(h.closure * 100)}% ${HAND_LABEL[s]}` : '—');
    $('dbg-left').textContent = fmt(lastFrame.leftHand, lastFrame.left);
    $('dbg-right').textContent = fmt(lastFrame.rightHand, lastFrame.right);
    $('dbg-left').dataset.state = lastFrame.left ?? '';
    $('dbg-right').dataset.state = lastFrame.right ?? '';
    $('dbg-angle').textContent = lastFrame.angleDeg == null ? '—' : `${lastFrame.angleDeg.toFixed(0)}°`;
    const h = CONFIG.hand;
    $('dbg-thr').textContent = `freio ≥ ${h.brakeStart * 100}% · punho ≥ ${h.fist * 100}%`;
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
