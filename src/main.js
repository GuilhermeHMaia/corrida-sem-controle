import { CONFIG, GestureInterpreter, CarPhysics, thresholdsFromCalibration } from './logic.js';
import { createWorld } from './scene.js';

const $ = (id) => document.getElementById(id);
const world = createWorld($('game'));
const gestures = new GestureInterpreter();
const car = new CarPhysics();

let source = null; // 'camera' | 'keyboard'
let tracker = null;
let drawDebug = null;
let lastFrame = null;
let lastMs = performance.now();

loadThresholds();

// ---------------------------------------------------------------------------
// Entrada por teclado (simula as mãos pra testar sem câmera)

const keys = new Set();
let keyAngle = 0;
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyR') resetCar();
});
addEventListener('keyup', (e) => keys.delete(e.code));

function keyboardFrame(dt) {
  const target = (keys.has('ArrowRight') ? 30 : 0) - (keys.has('ArrowLeft') ? 30 : 0);
  keyAngle += (target - keyAngle) * (1 - Math.exp(-dt * 8));
  if (keys.has('KeyH')) return { left: null, right: 'open', angleDeg: null, hands: [] };
  return {
    left: keys.has('KeyQ') ? 'closed' : 'open',
    right: keys.has('KeyP') ? 'closed' : 'open',
    angleDeg: keyAngle,
    hands: [],
  };
}

// ---------------------------------------------------------------------------
// Início

$('start-keyboard').onclick = () => begin('keyboard');
$('start-camera').onclick = async () => {
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
// Calibração: 2 s mãos abertas, 2 s fechadas

let calib = null;
$('calibrate').onclick = () => {
  calib = { phase: 'open', until: performance.now() + 2500, open: [], closed: [] };
};

function updateCalibration(now, frame) {
  if (!calib) return;
  const remaining = Math.ceil((calib.until - now) / 1000);
  if (frame.hands.length === 2) for (const h of frame.hands) calib[calib.phase].push(h.openness);
  $('calib-msg').hidden = false;
  $('calib-msg').textContent = calib.phase === 'open'
    ? `Segure o volante com as duas mãos abertas… ${remaining}`
    : `Agora feche as duas mãos… ${remaining}`;
  if (now < calib.until) return;
  if (calib.phase === 'open') {
    calib.phase = 'closed';
    calib.until = now + 2500;
    return;
  }
  const t = thresholdsFromCalibration(median(calib.open), median(calib.closed));
  if (t) {
    Object.assign(CONFIG.hand, t);
    try { localStorage.setItem('volante.thresholds', JSON.stringify(t)); } catch {}
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

function loadThresholds() {
  try {
    const t = JSON.parse(localStorage.getItem('volante.thresholds'));
    if (t && t.closeBelow < t.openAbove) Object.assign(CONFIG.hand, t);
  } catch {}
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

  let out = { mode: 'steer', steerDeg: gestures.steerDeg, braking: false, brakeFactor: 0, shift: 0 };
  if (source) {
    const frame = source === 'camera' ? tracker.poll(now) : keyboardFrame(dt);
    lastFrame = frame;
    if (calib) {
      updateCalibration(now, frame);
      out = gestures.update({ left: null, right: null, angleDeg: null }, now, dt); // congela durante calibração
    } else {
      out = gestures.update(frame, now, dt);
      car.update(dt, out);
    }
    if (out.shift) flashGear();
  }

  const { offTrack } = world.step(dt, car.speedKmh, out.steerDeg, CONFIG.steer.maxDeg);
  if (source) renderHud(out, offTrack);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function renderHud(out, offTrack) {
  $('speed').textContent = Math.round(car.speedKmh);
  $('gear').textContent = car.gear;
  $('ceiling').textContent = `teto ${car.ceilingKmh} km/h`;
  $('rpm-fill').style.width = `${Math.min(100, (car.speedKmh / car.ceilingKmh) * 100)}%`;
  $('brake-fill').style.width = `${out.brakeFactor * 100}%`;
  $('wheel').style.transform = `rotate(${out.steerDeg}deg)`;
  $('mode').textContent = MODE_LABEL[out.mode];
  $('mode').dataset.mode = out.mode;
  $('offtrack').hidden = !offTrack;

  if (source === 'camera' && lastFrame) {
    drawDebug($('cam-overlay').getContext('2d'), lastFrame);
    const fmt = (h, s) => (h ? `${h.openness.toFixed(2)} ${s === 'closed' ? 'fechada' : 'aberta'}` : '—');
    $('dbg-left').textContent = fmt(lastFrame.leftHand, lastFrame.left);
    $('dbg-right').textContent = fmt(lastFrame.rightHand, lastFrame.right);
    $('dbg-left').dataset.state = lastFrame.left ?? '';
    $('dbg-right').dataset.state = lastFrame.right ?? '';
    $('dbg-angle').textContent = lastFrame.angleDeg == null ? '—' : `${lastFrame.angleDeg.toFixed(0)}°`;
    $('dbg-thr').textContent = `fecha < ${CONFIG.hand.closeBelow.toFixed(2)} · abre > ${CONFIG.hand.openAbove.toFixed(2)}`;
  }
}

let gearTimer = 0;
function flashGear() {
  const el = $('gear-box');
  el.classList.add('flash');
  clearTimeout(gearTimer);
  gearTimer = setTimeout(() => el.classList.remove('flash'), 350);
}
