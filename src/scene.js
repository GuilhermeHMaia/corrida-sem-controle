// Cena 3D: pista em circuito, cenário, carro e câmera de perseguição.
import * as THREE from 'three';
import { resolveTreeCollision } from './logic.js';

const ROAD_HALF_WIDTH = 8;
const SAMPLES = 900;
const CHECKPOINTS = 6; // índice 0 = largada/chegada
const CAR_RADIUS = 1.6;

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fd3ff);
  scene.fog = new THREE.Fog(0x9fd3ff, 120, 650);

  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 2000);

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

  const track = buildTrack();
  scene.add(track.mesh, track.lines);
  const forest = buildTrees(track.points);
  scene.add(forest.group);

  const checkpoints = [];
  for (let i = 0; i < CHECKPOINTS; i++) {
    const p = track.curve.getPointAt(i / CHECKPOINTS);
    checkpoints.push({ x: p.x, z: p.z });
  }
  scene.add(buildStartLine(track.curve));

  const car = buildCar();
  scene.add(car.group);

  const onResize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', onResize);
  onResize();

  // estado do carro no plano
  const start = track.curve.getPointAt(0);
  const tan = track.curve.getTangentAt(0);
  const state = { x: start.x, z: start.z, heading: Math.atan2(tan.x, tan.z), wheelSpin: 0 };
  camera.position.set(state.x - Math.sin(state.heading) * 10, 5, state.z - Math.cos(state.heading) * 10);

  const camTarget = new THREE.Vector3();

  function step(dt, speedKmh, steerDeg, maxSteerDeg) {
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

    car.group.position.set(state.x, 0, state.z);
    car.group.rotation.y = state.heading;
    car.group.rotation.z = steerNorm * Math.min(1, v / 40) * 0.04; // leve rolagem
    for (const w of car.frontPivots) w.rotation.y = -steerNorm * 0.5;
    for (const w of car.wheels) w.rotation.x = state.wheelSpin;

    const fx = Math.sin(state.heading), fz = Math.cos(state.heading);
    const back = 9 + v * 0.04;
    const desired = new THREE.Vector3(state.x - fx * back, 3.6 + v * 0.01, state.z - fz * back);
    camera.position.lerp(desired, 1 - Math.exp(-dt * 5));
    camTarget.set(state.x + fx * 6, 1.2, state.z + fz * 6);
    camera.lookAt(camTarget);
    camera.fov = 62 + Math.min(18, v * 0.25);
    camera.updateProjectionMatrix();

    sun.position.set(state.x + 80, 140, state.z + 40);
    sun.target.position.set(state.x, 0, state.z);

    renderer.render(scene, camera);
    return {
      offTrack: distanceToTrack(track.points, state.x, state.z) > ROAD_HALF_WIDTH + 1,
      collided,
      x: state.x,
      z: state.z,
    };
  }

  return { step, checkpoints, checkpointRadius: ROAD_HALF_WIDTH + 6 };
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

function buildTrack() {
  const ctrl = [
    [0, 0], [180, -20], [320, 60], [360, 220], [260, 330], [120, 290],
    [60, 400], [-120, 420], [-260, 300], [-240, 140], [-120, 90], [-160, -60],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z));
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

  return { curve, points: points.slice(0, SAMPLES), mesh, lines };
}

function buildTrees(points) {
  const group = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.4, 0.5, 3, 6);
  const leafGeo = new THREE.ConeGeometry(2.6, 7, 7);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2b });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2f6b34 });
  const COUNT = 420;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, COUNT);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, COUNT);
  trunks.castShadow = leaves.castShadow = true;
  const m = new THREE.Matrix4();
  let rnd = 12345;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const trees = [];
  while (trees.length < COUNT) {
    const x = -500 + rand() * 1100, z = -250 + rand() * 900;
    if (distanceToTrack(points, x, z) < ROAD_HALF_WIDTH + 6) continue;
    const s = 0.7 + rand() * 0.8;
    m.makeScale(s, s, s).setPosition(x, 1.5 * s, z);
    trunks.setMatrixAt(trees.length, m);
    m.makeScale(s, s, s).setPosition(x, 6 * s, z);
    leaves.setMatrixAt(trees.length, m);
    trees.push({ x, z, r: 0.6 * s }); // só o tronco colide; a copa fica acima do carro
  }
  group.add(trunks, leaves);
  return { group, trees };
}

function buildCar() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 4.2), new THREE.MeshLambertMaterial({ color: 0xd62828 }));
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
  return { group, wheels, frontPivots };
}

function distanceToTrack(points, x, z) {
  let best = Infinity;
  for (let i = 0; i < points.length; i += 3) {
    const d = (points[i].x - x) ** 2 + (points[i].z - z) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
