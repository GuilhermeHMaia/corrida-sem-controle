// Cena 3D: pistas do campeonato, cenário, carros (jogador + adversários) e câmeras.
import * as THREE from 'three';
import { resolveTreeCollision } from './logic.js';
import { buildCockpit, EYE, LOOK } from './cockpit.js';
import { outlineOf } from './map.js';

const ROAD_HALF_WIDTH = 8;
const SAMPLES = 900;
const CHECKPOINTS = 6; // índice 0 = largada/chegada
const CAR_RADIUS = 1.6;
const AI_HIT_DIST = 3.4;

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, 1, 0.05, 2000);

  scene.add(new THREE.HemisphereLight(0xdff1ff, 0x4a6b3a, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(80, 140, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 400 });
  scene.add(sun, sun.target);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    new THREE.MeshLambertMaterial({ color: 0x5f9e4a }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const car = buildCar(0xd62828);
  scene.add(car.group);
  const cockpit = buildCockpit();
  car.group.add(cockpit.group);
  let view = 'cockpit'; // 'cockpit' | 'chase'

  const aiCars = [];
  let trackGroup = null;
  let track = null;
  let forest = { trees: [] };

  const onResize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', onResize);
  onResize();

  const state = { x: 0, z: 0, heading: 0, wheelSpin: 0 };
  const camTarget = new THREE.Vector3();
  let seatOffset = 0; // ajuste de altura do banco (↑/↓)
  let shakeTime = 0;

  /** Troca a pista: descarta a anterior, monta a nova e devolve os dados pra corrida. */
  function loadTrack(def, opponents = []) {
    if (trackGroup) {
      scene.remove(trackGroup);
      disposeTree(trackGroup);
    }
    trackGroup = new THREE.Group();
    scene.add(trackGroup);

    scene.background = new THREE.Color(def.sky);
    scene.fog = new THREE.Fog(def.sky, 120, 650);
    ground.material.color.setHex(def.ground);

    track = buildTrack(def);
    forest = buildTrees(track.points, def.tree);
    trackGroup.add(track.mesh, track.lines, forest.group, buildStartLine(track.curve));

    // adversários (reaproveita os carros já criados quando a pista troca)
    while (aiCars.length < opponents.length) {
      const c = buildCar(0xffffff);
      scene.add(c.group);
      aiCars.push(c);
    }
    aiCars.forEach((c, i) => {
      c.group.visible = i < opponents.length;
      if (opponents[i]) for (const m of c.shell) m.material.color.setHex(opponents[i].color ?? 0xffffff);
    });

    const checkpoints = [];
    for (let i = 0; i < CHECKPOINTS; i++) {
      const p = track.curve.getPointAt(i / CHECKPOINTS);
      checkpoints.push({ x: p.x, z: p.z });
    }

    return {
      length: track.length,
      curvature: track.curvature,
      checkpoints,
      checkpointRadius: ROAD_HALF_WIDTH + 6,
      outline: outlineOf(track.points, 140),
    };
  }

  /** Coloca o carro do jogador no grid (u = posição na volta, lane = deslocamento lateral). */
  function placePlayer(u, lane = 0) {
    const p = pointAt(track, u, lane);
    state.x = p.x;
    state.z = p.z;
    state.heading = p.heading;
    state.wheelSpin = 0;
    car.group.position.set(state.x, 0, state.z);
    car.group.rotation.set(0, state.heading, 0);
    camera.position.set(state.x - Math.sin(state.heading) * 9, 3.6, state.z - Math.cos(state.heading) * 9);
  }

  function step(dt, speedKmh, steerDeg, maxSteerDeg, cockpitInfo, aiStates = []) {
    if (!track) {
      renderer.render(scene, camera);
      return null;
    }
    const v = speedKmh / 3.6;
    const steerNorm = steerDeg / maxSteerDeg;
    // arcade: vira pouco parado (mas o suficiente pra desencostar de uma árvore),
    // melhor em velocidade média, um pouco menos em alta
    const yawRate = -steerNorm * 1.3 * Math.max(0.35, Math.min(1, v / 8)) * (1 - 0.35 * Math.min(1, v / 60));
    state.heading += yawRate * dt;
    state.x += Math.sin(state.heading) * v * dt;
    state.z += Math.cos(state.heading) * v * dt;
    state.wheelSpin += (v / 0.4) * dt;
    const collided = resolveTreeCollision(state, forest.trees, CAR_RADIUS);

    // adversários
    const bumpedAi = [];
    const aiPositions = [];
    aiStates.forEach((ai, i) => {
      const mesh = aiCars[i];
      if (!mesh) return;
      const p = pointAt(track, ai.u, ai.lane ?? 0);
      mesh.group.position.set(p.x, 0, p.z);
      mesh.group.rotation.y = p.heading;
      for (const w of mesh.wheels) w.rotation.x = state.wheelSpin;
      aiPositions.push({ x: p.x, z: p.z });
      const d = Math.hypot(p.x - state.x, p.z - state.z);
      if (d < AI_HIT_DIST) {
        const nx = (state.x - p.x) / (d || 1), nz = (state.z - p.z) / (d || 1);
        state.x = p.x + nx * AI_HIT_DIST;
        state.z = p.z + nz * AI_HIT_DIST;
        bumpedAi.push(i);
      }
    });

    car.group.position.set(state.x, 0, state.z);
    car.group.rotation.y = state.heading;
    car.group.rotation.z = steerNorm * Math.min(1, v / 40) * 0.04; // leve rolagem
    for (const w of car.frontPivots) w.rotation.y = -steerNorm * 0.5;
    for (const w of car.wheels) w.rotation.x = state.wheelSpin;

    cockpit.group.visible = view === 'cockpit';
    for (const m of car.shell) m.visible = view !== 'cockpit';
    if (cockpitInfo) cockpit.update(dt, cockpitInfo);

    if (view === 'cockpit') {
      car.group.updateMatrixWorld();
      // tremor leve que cresce com a velocidade
      shakeTime += dt;
      const shake = Math.min(1, v / 55) * 0.006;
      const eye = EYE.clone();
      eye.y += seatOffset;
      eye.x += Math.sin(shakeTime * 37) * shake;
      eye.y += Math.sin(shakeTime * 53 + 1.3) * shake;
      camera.position.copy(car.group.localToWorld(eye));
      camera.up.set(0, 1, 0).applyQuaternion(car.group.quaternion);
      camTarget.copy(LOOK);
      camTarget.y += seatOffset;
      camera.lookAt(car.group.localToWorld(camTarget));
      camera.fov = 62 + Math.min(12, v * 0.18);
    } else {
      const fx = Math.sin(state.heading), fz = Math.cos(state.heading);
      const back = 9 + v * 0.04;
      const desired = new THREE.Vector3(state.x - fx * back, 3.6 + v * 0.01, state.z - fz * back);
      camera.position.lerp(desired, 1 - Math.exp(-dt * 5));
      camera.up.set(0, 1, 0);
      camTarget.set(state.x + fx * 6, 1.2, state.z + fz * 6);
      camera.lookAt(camTarget);
      camera.fov = 62 + Math.min(18, v * 0.25);
    }
    camera.updateProjectionMatrix();

    sun.position.set(state.x + 80, 140, state.z + 40);
    sun.target.position.set(state.x, 0, state.z);

    renderer.render(scene, camera);
    const near = nearestSample(track.points, state.x, state.z);
    return {
      offTrack: near.distance > ROAD_HALF_WIDTH + 1,
      collided,
      bumpedAi,
      aiPositions,
      x: state.x,
      z: state.z,
      u: near.index / track.points.length,
    };
  }

  function setView(v) {
    view = v;
    if (v === 'chase') {
      // evita a câmera "voar" de dentro do carro até a posição de perseguição
      camera.position.set(state.x - Math.sin(state.heading) * 9, 3.6, state.z - Math.cos(state.heading) * 9);
    }
  }

  /** Sobe/desce o banco; limitado pra não atravessar teto nem painel. Retorna o valor aplicado. */
  function setSeatOffset(value) {
    seatOffset = Math.max(-0.12, Math.min(0.2, value));
    return seatOffset;
  }

  return {
    loadTrack, placePlayer, step, setView, getView: () => view, setSeatOffset, getSeatOffset: () => seatOffset,
  };
}

/** Traçado de uma pista sem montar a cena — usado pelos mapas do menu. */
export function trackOutline(def, count = 140) {
  const ctrl = def.points.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(ctrl, true, 'centripetal');
  return outlineOf(curve.getSpacedPoints(count), count);
}

/** Ponto do traçado em u (0..1), com deslocamento lateral opcional. */
function pointAt(track, u, lane = 0) {
  const pts = track.points;
  const n = pts.length;
  const i = ((Math.floor(u * n) % n) + n) % n;
  const p = pts[i];
  const q = pts[(i + 1) % n];
  const dx = q.x - p.x, dz = q.z - p.z;
  const len = Math.hypot(dx, dz) || 1;
  return {
    x: p.x + (-dz / len) * lane,
    z: p.z + (dx / len) * lane,
    heading: Math.atan2(dx, dz),
  };
}

function buildStartLine(curve) {
  const group = new THREE.Group();
  const p = curve.getPointAt(0);
  const tan = curve.getTangentAt(0);
  const heading = Math.atan2(tan.x, tan.z);

  const tex = document.createElement('canvas');
  tex.width = 64;
  tex.height = 16;
  const ctx = tex.getContext('2d');
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 4; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#f5f5f5';
      ctx.fillRect(x * 4, y * 4, 4, 4);
    }
  }
  const texture = new THREE.CanvasTexture(tex);
  texture.magFilter = THREE.NearestFilter;
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD_HALF_WIDTH * 2, 3),
    new THREE.MeshLambertMaterial({ map: texture }),
  );
  strip.rotation.x = -Math.PI / 2;
  strip.position.y = 0.05;
  strip.receiveShadow = true;

  const postGeo = new THREE.BoxGeometry(0.6, 7, 0.6);
  const archMat = new THREE.MeshLambertMaterial({ color: 0x2b2f38 });
  const postL = new THREE.Mesh(postGeo, archMat);
  const postR = new THREE.Mesh(postGeo, archMat);
  postL.position.set(ROAD_HALF_WIDTH + 1, 3.5, 0);
  postR.position.set(-ROAD_HALF_WIDTH - 1, 3.5, 0);
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(ROAD_HALF_WIDTH * 2 + 2.6, 1.4, 0.6),
    new THREE.MeshLambertMaterial({ map: texture }),
  );
  beam.position.y = 7;
  for (const m of [postL, postR, beam]) m.castShadow = true;

  group.add(strip, postL, postR, beam);
  group.position.set(p.x, 0, p.z);
  group.rotation.y = heading;
  return group;
}

function buildTrack(def) {
  const ctrl = def.points.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(ctrl, true, 'centripetal');
  const points = curve.getSpacedPoints(SAMPLES);

  const pos = [], idx = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const p = points[i % SAMPLES];
    const n = points[(i + 1) % SAMPLES];
    const dx = n.x - p.x, dz = n.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len, nz = dx / len;
    pos.push(p.x + nx * ROAD_HALF_WIDTH, 0.02, p.z + nz * ROAD_HALF_WIDTH);
    pos.push(p.x - nx * ROAD_HALF_WIDTH, 0.02, p.z - nz * ROAD_HALF_WIDTH);
    if (i < SAMPLES) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x3b3f45, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;

  // faixa central tracejada
  const dashes = [];
  for (let i = 0; i < SAMPLES; i += 6) {
    const a = points[i], b = points[(i + 3) % SAMPLES];
    dashes.push(a.x, 0.04, a.z, b.x, 0.04, b.z);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(dashes, 3));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xf5f5f5 }));

  const sampled = points.slice(0, SAMPLES);
  return {
    curve,
    points: sampled,
    mesh,
    lines,
    length: curve.getLength(),
    curvature: curvatureOf(sampled, curve.getLength() / SAMPLES),
  };
}

/** Curvatura por amostra (rad/m), suavizada — usada pelo ritmo dos adversários. */
function curvatureOf(points, stepLen) {
  const n = points.length;
  const raw = points.map((p, i) => {
    const a = points[(i - 3 + n) % n], b = points[(i + 3) % n];
    const h1 = Math.atan2(p.x - a.x, p.z - a.z);
    const h2 = Math.atan2(b.x - p.x, b.z - p.z);
    let d = h2 - h1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d) / (stepLen * 6);
  });
  // média móvel pra não oscilar entre amostras vizinhas
  return raw.map((_, i) => {
    let sum = 0;
    for (let k = -8; k <= 8; k++) sum += raw[(i + k + n) % n];
    return sum / 17;
  });
}

function buildTrees(points, spec = {}) {
  const { trunk = 0x6b4a2b, leaf = 0x2f6b34, count = 420 } = spec;
  const group = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.4, 0.5, 3, 6);
  const leafGeo = new THREE.ConeGeometry(2.6, 7, 7);
  const trunkMat = new THREE.MeshLambertMaterial({ color: trunk });
  const leafMat = new THREE.MeshLambertMaterial({ color: leaf });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, count);
  trunks.castShadow = leaves.castShadow = true;

  // área de espalhamento: caixa do traçado com folga
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  minX -= 120; maxX += 120; minZ -= 120; maxZ += 120;

  const m = new THREE.Matrix4();
  let rnd = 12345;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const trees = [];
  let tries = 0;
  while (trees.length < count && tries < count * 40) {
    tries++;
    const x = minX + rand() * (maxX - minX), z = minZ + rand() * (maxZ - minZ);
    if (nearestSample(points, x, z).distance < ROAD_HALF_WIDTH + 6) continue;
    const s = 0.7 + rand() * 0.8;
    m.makeScale(s, s, s).setPosition(x, 1.5 * s, z);
    trunks.setMatrixAt(trees.length, m);
    m.makeScale(s, s, s).setPosition(x, 6 * s, z);
    leaves.setMatrixAt(trees.length, m);
    trees.push({ x, z, r: 0.6 * s }); // só o tronco colide; a copa fica acima do carro
  }
  trunks.count = leaves.count = trees.length;
  group.add(trunks, leaves);
  return { group, trees };
}

function buildCar(color) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 4.2), new THREE.MeshLambertMaterial({ color }));
  body.position.y = 0.75;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2), new THREE.MeshLambertMaterial({ color: 0x1d1d24 }));
  cabin.position.set(0, 1.35, -0.3);
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 0.5), new THREE.MeshLambertMaterial({ color: 0x1d1d24 }));
  spoiler.position.set(0, 1.35, -2);
  for (const mesh of [body, cabin, spoiler]) mesh.castShadow = true;
  group.add(body, cabin, spoiler);

  const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.35, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const wheels = [], frontPivots = [];
  for (const [x, z, front] of [[-1.05, 1.35, true], [1.05, 1.35, true], [-1.05, -1.35, false], [1.05, -1.35, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.4, z);
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.castShadow = true;
    pivot.add(w);
    group.add(pivot);
    wheels.push(w);
    if (front) frontPivots.push(pivot);
  }
  // só a carroceria muda de cor (o body é o primeiro da lista)
  return { group, wheels, frontPivots, shell: [body], parts: [body, cabin, spoiler] };
}

function nearestSample(points, x, z) {
  let best = Infinity, index = 0;
  for (let i = 0; i < points.length; i += 3) {
    const d = (points[i].x - x) ** 2 + (points[i].z - z) ** 2;
    if (d < best) { best = d; index = i; }
  }
  return { distance: Math.sqrt(best), index };
}

function disposeTree(root) {
  root.traverse((o) => {
    o.geometry?.dispose?.();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
    else m?.dispose?.();
  });
}
