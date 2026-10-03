// Pose sources: real camera + MediaPipe PoseLandmarker (on-device, WASM vendored locally for offline use),
// or a simulated source (demo fallback). Both expose the same interface:
//   const src = await createSource({ sim, kind, simOpts, videoEl }); src.next(tMs) -> {lms, poses, aspect}; src.stop()
import { simFrame } from './sim.js';

const MODEL_URL = './vendor/models/pose_landmarker_lite.task';
const WASM_DIR = './vendor/mediapipe/wasm';
export const BODY_CONNECTIONS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32]];

let landmarkerPromise = null;
async function getLandmarker(onStatus) {
  if (landmarkerPromise) return landmarkerPromise;
  landmarkerPromise = (async () => {
    const head = await fetch(MODEL_URL, { method: 'HEAD' }).catch(() => null);
    if (!head || !head.ok) throw Object.assign(new Error('model_missing'), { code: 'model_missing' });
    onStatus?.('loadingModel');
    const { PoseLandmarker, FilesetResolver } = await import('./vendor/mediapipe/vision_bundle.mjs');
    const fileset = await FilesetResolver.forVisionTasks(WASM_DIR);
    const make = (delegate) => PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate }, runningMode: 'VIDEO', numPoses: 2,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    try { return await make('GPU'); } catch { return await make('CPU'); }   // low-end phones often lack WebGL2 compute
  })();
  landmarkerPromise.catch(() => { landmarkerPromise = null; });
  return landmarkerPromise;
}

export async function createSource({ sim = false, kind = 'squat', simOpts = {}, videoEl, onStatus }) {
  if (sim) {
    const warp = (t) => t + 180 * Math.sin(t / 1700); // human-like tempo variation
    return { sim: true, aspect: 1, connections: BODY_CONNECTIONS, next: (t) => ({ ...simFrame(kind, warp(t), simOpts), aspect: 1 }), stop() {} };
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
  } catch (e) { throw Object.assign(new Error('cam_denied'), { code: 'cam_denied' }); }
  videoEl.srcObject = stream; videoEl.muted = true; videoEl.playsInline = true;
  await videoEl.play();
  const lm = await getLandmarker(onStatus);
  let lastVideoTime = -1, last = { lms: null, poses: 0 };
  return {
    sim: false, get aspect() { return videoEl.videoWidth / videoEl.videoHeight || 4 / 3; }, connections: BODY_CONNECTIONS,
    next() {
      if (videoEl.readyState >= 2 && videoEl.currentTime !== lastVideoTime) {
        lastVideoTime = videoEl.currentTime;
        const res = lm.detectForVideo(videoEl, performance.now());
        const poses = res.landmarks || [];
        // choose the largest person in frame; report how many were seen so the integrity gate can reject crowds
        let best = null, bestH = -1;
        for (const p of poses) { const ys = p.map((q) => q.y); const h = Math.max(...ys) - Math.min(...ys); if (h > bestH) { bestH = h; best = p; } }
        last = { lms: best, poses: poses.length };
      }
      return { ...last, aspect: this.aspect };
    },
    stop() { stream.getTracks().forEach((t) => t.stop()); videoEl.srcObject = null; },
  };
}
