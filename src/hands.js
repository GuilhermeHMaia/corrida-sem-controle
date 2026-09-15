// Wrapper do MediaPipe Hand Landmarker + tradução pra estado esquerda/direita.
import { FilesetResolver, HandLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
import { CONFIG, handOpenness, handClosure, classifyHand, wheelAngleDeg } from './logic.js';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class HandTracker {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.prev = { left: null, right: null };
    this.frame = emptyFrame();
  }

  async init() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    });
    this.video.srcObject = stream;
    await this.video.play();

    const fileset = await FilesetResolver.forVisionTasks(WASM);
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
    });
    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, opts('GPU'));
    } catch {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, opts('CPU'));
    }
  }

  /** Processa o frame atual da câmera; retorna o último resultado se não houver frame novo. */
  poll(nowMs) {
    const v = this.video;
    if (!this.landmarker || v.readyState < 2 || v.currentTime === this.lastVideoTime) return this.frame;
    this.lastVideoTime = v.currentTime;
    const res = this.landmarker.detectForVideo(v, nowMs);
    this.frame = this.interpret(res, v.videoWidth, v.videoHeight);
    return this.frame;
  }

  interpret(res, W, H) {
    const hands = res.landmarks.map((lm, i) => {
      const cx = (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5;
      const cy = (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5;
      const openness = handOpenness(res.worldLandmarks[i] ?? lm);
      return {
        landmarks: lm,
        raw: { x: cx, y: cy },
        // coordenadas de tela espelhada, em pixels (preserva proporção)
        screen: { x: (1 - cx) * W, y: cy * H },
        openness,
        closure: handClosure(openness, CONFIG.hand.calib),
      };
    });

    // Esquerda/direita pela posição na tela, não pelo rótulo handedness.
    hands.sort((a, b) => a.screen.x - b.screen.x);
    const frame = emptyFrame();
    frame.hands = hands;
    if (hands.length === 2) {
      const [l, r] = hands;
      frame.left = classifyHand(l.closure, this.prev.left, CONFIG.hand);
      frame.right = classifyHand(r.closure, this.prev.right, CONFIG.hand);
      frame.leftClosure = l.closure;
      frame.rightClosure = r.closure;
      frame.leftHand = l;
      frame.rightHand = r;
      frame.angleDeg = wheelAngleDeg(l.screen, r.screen);
    }
    this.prev = { left: frame.left, right: frame.right };
    return frame;
  }
}

function emptyFrame() {
  return {
    hands: [], left: null, right: null, leftClosure: null, rightClosure: null,
    leftHand: null, rightHand: null, angleDeg: null,
  };
}

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

/** Desenha landmarks e a linha do volante no canvas (já espelhado via CSS junto com o vídeo). */
export function drawDebug(ctx, frame) {
  const { width: W, height: H } = ctx.canvas;
  ctx.clearRect(0, 0, W, H);
  const colorOf = (h) => (h === frame.leftHand ? stateColor(frame.left) : h === frame.rightHand ? stateColor(frame.right) : '#aaa');
  for (const h of frame.hands) {
    const c = colorOf(h);
    ctx.strokeStyle = c;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      ctx.moveTo(h.landmarks[a].x * W, h.landmarks[a].y * H);
      ctx.lineTo(h.landmarks[b].x * W, h.landmarks[b].y * H);
    }
    ctx.stroke();
  }
  if (frame.leftHand && frame.rightHand) {
    // o canvas é espelhado por CSS junto com o vídeo, então desenhamos em coords cruas
    ctx.strokeStyle = '#ffd400';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(frame.leftHand.raw.x * W, frame.leftHand.raw.y * H);
    ctx.lineTo(frame.rightHand.raw.x * W, frame.rightHand.raw.y * H);
    ctx.stroke();
  }
}

export function stateColor(s) {
  return { open: '#3ddc84', partial: '#ffb74d', closed: '#ff5252' }[s] ?? '#aaa';
}
