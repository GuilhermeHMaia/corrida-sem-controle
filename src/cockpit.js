// Interior do carro (estilo GT fechado): painel, colunas, teto, volante com display,
// borboletas de câmbio e luvas que abrem/fecham conforme as mãos do jogador.
// Coordenadas locais do carro: +z = frente, +y = cima, +x = esquerda do motorista.
import * as THREE from 'three';

export const EYE = new THREE.Vector3(0, 1.34, -0.25);

const STATE_COLOR = {
  open: new THREE.Color(0x3ddc84),
  partial: new THREE.Color(0xffb74d),
  closed: new THREE.Color(0xff5252),
};
const GLOVE_BASE = new THREE.Color(0x2a2d33);
const RIM_RADIUS = 0.19;

export function buildCockpit() {
  const group = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: 0x1a1c20 });
  const carbon = new THREE.MeshLambertMaterial({ color: 0x26282e });

  // painel
  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.24, 0.6), dark);
  dash.position.set(0, 1.05, 0.85);
  // capa do painel atrás do volante
  const binnacle = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.25), carbon);
  binnacle.position.set(0, 1.2, 0.7);
  // na visão de dentro a lataria externa fica oculta; o cockpit tem capô, portas e assoalho próprios
  const hood = new THREE.Mesh(new THREE.BoxGeometry(2, 0.3, 1.25), new THREE.MeshLambertMaterial({ color: 0xd62828 }));
  hood.position.set(0, 0.95, 1.5);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 2.4), dark);
  floor.position.set(0, 0.55, -0.2);
  group.add(dash, binnacle, hood, floor);
  for (const side of [1, -1]) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.62, 2), carbon);
    door.position.set(0.9 * side, 0.86, -0.15);
    group.add(door);
  }

  // colunas do para-brisa, moldura superior e teto
  for (const side of [1, -1]) {
    group.add(beam(new THREE.Vector3(0.84 * side, 1.16, 0.8), new THREE.Vector3(0.72 * side, 1.64, 0.22), 0.07, dark));
    group.add(beam(new THREE.Vector3(0.86 * side, 1.16, 0.8), new THREE.Vector3(0.86 * side, 1.16, -0.9), 0.06, dark));
  }
  group.add(beam(new THREE.Vector3(0.74, 1.64, 0.22), new THREE.Vector3(-0.74, 1.64, 0.22), 0.07, dark));
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 1.6), dark);
  roof.position.set(0, 1.68, -0.58);
  group.add(roof);

  // volante: pivô inclinado (coluna) → grupo que gira
  const column = new THREE.Group();
  column.position.set(0, 1.16, 0.38);
  column.rotation.x = 0.38;
  const wheel = new THREE.Group();
  column.add(wheel);
  group.add(column);

  const rimMat = new THREE.MeshLambertMaterial({ color: 0x1b1b1f });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(RIM_RADIUS, 0.022, 10, 48), rimMat);
  const topMark = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.05), new THREE.MeshLambertMaterial({ color: 0xffd400 }));
  topMark.position.set(0, RIM_RADIUS, 0);
  const hub = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.04), carbon);
  for (const [x, y, w, h] of [[0.14, 0, 0.1, 0.03], [-0.14, 0, 0.1, 0.03], [0, -0.12, 0.03, 0.12]]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.025), carbon);
    spoke.position.set(x, y, 0);
    wheel.add(spoke);
  }
  wheel.add(rim, topMark, hub);

  // display no centro do volante
  const displayCanvas = document.createElement('canvas');
  displayCanvas.width = 256;
  displayCanvas.height = 128;
  const displayTex = new THREE.CanvasTexture(displayCanvas);
  displayTex.colorSpace = THREE.SRGBColorSpace;
  const display = new THREE.Mesh(
    new THREE.PlaneGeometry(0.17, 0.085),
    new THREE.MeshBasicMaterial({ map: displayTex }),
  );
  display.rotation.y = Math.PI; // de frente pro motorista (−z)
  display.position.set(0, 0.005, -0.022);
  wheel.add(display);

  // borboletas atrás do volante (giram com ele, como num carro de corrida)
  const paddleMat = () => new THREE.MeshLambertMaterial({ color: 0x3a3d44, emissive: 0x000000 });
  const paddles = { left: null, right: null };
  for (const [key, side] of [['left', 1], ['right', -1]]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.13, 0.012), paddleMat());
    p.position.set(0.16 * side, 0.03, 0.045);
    p.userData = { baseZ: 0.045, t: 0 };
    wheel.add(p);
    paddles[key] = p;
  }

  // luvas: esquerda às 9h, direita às 3h (do ponto de vista do motorista)
  const gloves = {
    left: buildGlove(1),
    right: buildGlove(-1),
  };
  gloves.left.group.position.set(RIM_RADIUS, 0, -0.01);
  gloves.right.group.position.set(-RIM_RADIUS, 0, -0.01);
  wheel.add(gloves.left.group, gloves.right.group);

  let displayTimer = 0;

  /**
   * info: { wheelDeg, hands: {left:{state,closure}|null, right:...}, shift, braking, brakeFactor,
   *         speedKmh, gear, ceilingKmh, offTrack }
   */
  function update(dt, info) {
    wheel.rotation.z = THREE.MathUtils.degToRad(info.wheelDeg);

    for (const key of ['left', 'right']) {
      gloves[key].set(info.hands[key], dt);
      const p = paddles[key];
      if ((key === 'right' && info.shift > 0) || (key === 'left' && info.shift < 0)) p.userData.t = 0.3;
      p.userData.t = Math.max(0, p.userData.t - dt);
      const pulled = p.userData.t > 0;
      p.position.z = p.userData.baseZ - (pulled ? 0.03 : 0);
      p.material.emissive.setHex(pulled ? 0x8a7300 : 0x000000);
    }

    displayTimer -= dt;
    if (displayTimer <= 0) {
      displayTimer = 1 / 20;
      drawDisplay(displayCanvas.getContext('2d'), info);
      displayTex.needsUpdate = true;
    }
  }

  return { group, update };
}

function beam(a, b, thickness, material) {
  const len = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, thickness, len), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.lookAt(b);
  return mesh;
}

/** Luva estilizada: palma, punho colorido pelo estado e 4 dedos + polegar que dobram. */
function buildGlove(side) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: GLOVE_BASE.clone() });
  const cuffMat = new THREE.MeshLambertMaterial({ color: STATE_COLOR.open.clone() });

  // palma sobre o aro, levemente inclinada pra fora
  const hand = new THREE.Group();
  hand.rotation.z = -0.35 * side;
  group.add(hand);

  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.035), mat);
  hand.add(palm);
  const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.035, 0.045), cuffMat);
  cuff.position.set(0, -0.055, -0.005);
  hand.add(cuff);

  const fingers = [];
  const xs = [-0.027, -0.009, 0.009, 0.027];
  for (const x of xs) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.04, 0);
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.055, 0.02), mat);
    f.position.y = 0.0275;
    pivot.add(f);
    hand.add(pivot);
    fingers.push(pivot);
  }
  const thumb = new THREE.Group();
  thumb.position.set(-0.04 * side, 0.0, -0.005);
  thumb.rotation.z = 0.9 * side;
  const tm = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.045, 0.02), mat);
  tm.position.y = 0.022;
  thumb.add(tm);
  hand.add(thumb);

  let curl = 0;
  const target = new THREE.Color();

  function set(h, dt) {
    group.visible = !!h;
    if (!h) return;
    const k = 1 - Math.exp(-dt / 0.05);
    curl += (h.closure - curl) * k;
    // dedos dobram "por cima" do aro, pra longe do motorista (+z)
    for (const f of fingers) f.rotation.x = curl * 1.9;
    thumb.rotation.x = curl * 1.2;
    const stateColor = STATE_COLOR[h.state] ?? STATE_COLOR.open;
    cuffMat.color.lerp(stateColor, k);
    target.copy(GLOVE_BASE).lerp(stateColor, h.state === 'open' ? 0 : 0.55);
    mat.color.lerp(target, k);
  }

  return { group, set };
}

function drawDisplay(ctx, info) {
  const W = 256, H = 128;
  ctx.fillStyle = '#05070a';
  ctx.fillRect(0, 0, W, H);

  // barra de rotação (quão perto do teto da marcha)
  const rpm = Math.min(1, info.speedKmh / Math.max(1, info.ceilingKmh));
  const segs = 12;
  for (let i = 0; i < segs; i++) {
    const on = i < Math.round(rpm * segs);
    ctx.fillStyle = on ? (i < 7 ? '#3ddc84' : i < 10 ? '#ffd400' : '#ff5252') : '#1b1f26';
    ctx.fillRect(10 + i * 20, 8, 16, 12);
  }

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 64px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(info.gear), W / 2, 70);

  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(String(Math.round(info.speedKmh)), 12, 62);
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillStyle = '#99a';
  ctx.fillText('km/h', 12, 88);

  ctx.textAlign = 'right';
  ctx.fillStyle = info.offTrack ? '#ffb74d' : '#99a';
  ctx.fillText(info.offTrack ? 'GRAMA' : `teto ${Math.round(info.ceilingKmh)}`, W - 12, 62);

  // freio
  ctx.fillStyle = '#1b1f26';
  ctx.fillRect(10, H - 18, W - 20, 8);
  ctx.fillStyle = '#ff5252';
  ctx.fillRect(10, H - 18, (W - 20) * info.brakeFactor, 8);
}
