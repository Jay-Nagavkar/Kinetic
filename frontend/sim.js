// Synthetic pose generator. Used for (1) the in-app "Simulated demo" fallback when the camera or model
// is unavailable on stage, and (2) deterministic engine tests. Coordinates assume aspect = 1.
const rad = (d) => (d * Math.PI) / 180;
const blank = (v = 0.99) => Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: v }));
const put = (lms, i, x, y) => { lms[i].x = x; lms[i].y = y; };
const bell = (t, period) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (t % period)) / period); // 0 -> 1 -> 0

export function squatPose(kneeAngle) {
  const lms = blank(); const L = 0.22; const t = 180 - kneeAngle; const a = 0.4 * t;
  const A = { x: 0.5, y: 0.9 };
  const K = { x: A.x + L * Math.sin(rad(a)), y: A.y - L * Math.cos(rad(a)) };
  const H = { x: K.x + L * Math.sin(rad(a - t)), y: K.y - L * Math.cos(rad(a - t)) };
  const lean = 0.3 * t; const S = { x: H.x + 0.25 * Math.sin(rad(lean)), y: H.y - 0.25 * Math.cos(rad(lean)) };
  const E = { x: S.x + 0.02, y: S.y + 0.12 }, W = { x: S.x + 0.06, y: S.y + 0.2 };
  for (const [off, side] of [[0, 'L'], [0.006, 'R']]) {
    const base = side === 'L' ? 0 : 1;
    put(lms, 27 + base, A.x + off, A.y); put(lms, 25 + base, K.x + off, K.y); put(lms, 23 + base, H.x + off, H.y);
    put(lms, 11 + base, S.x + off, S.y); put(lms, 13 + base, E.x + off, E.y); put(lms, 15 + base, W.x + off, W.y);
  }
  return lms;
}

export function pushupPose(elbowAngle, { sag = 0 } = {}) {
  const lms = blank(); const La = 0.1; const W = { x: 0.25, y: 0.82 }; const Ank = { x: 0.85, y: 0.82 };
  const h = 2 * La * Math.sin(rad(elbowAngle / 2));
  const S = { x: W.x, y: W.y - h };
  const E = { x: W.x + La * Math.cos(rad(elbowAngle / 2)), y: W.y - h / 2 };
  const Hp = { x: S.x + 0.45 * (Ank.x - S.x), y: S.y + 0.45 * (Ank.y - S.y) + sag };
  for (const [off, base] of [[0, 0], [0.004, 1]]) {
    put(lms, 11 + base, S.x + off, S.y); put(lms, 13 + base, E.x + off, E.y); put(lms, 15 + base, W.x + off, W.y);
    put(lms, 23 + base, Hp.x + off, Hp.y); put(lms, 27 + base, Ank.x + off, Ank.y); put(lms, 25 + base, (Hp.x + Ank.x) / 2, (Hp.y + Ank.y) / 2);
  }
  return lms;
}

export function standingPose(liftRatio = 0, liftLeft = true) {
  const lms = blank(); const hipY = 0.5, ankY = 0.9, leg = ankY - hipY;
  const pts = { L: { x: 0.47 }, R: { x: 0.53 } };
  for (const [side, base] of [['L', 0], ['R', 1]]) {
    const lifted = (side === 'L') === liftLeft && liftRatio > 0;
    const up = lifted ? liftRatio * leg : 0;
    put(lms, 23 + base, pts[side].x, hipY); put(lms, 25 + base, pts[side].x, 0.7 - up * 0.5); put(lms, 27 + base, pts[side].x, ankY - up);
    put(lms, 11 + base, pts[side].x, 0.25); put(lms, 13 + base, pts[side].x, 0.38); put(lms, 15 + base, pts[side].x, 0.5);
  }
  return lms;
}

export function armRaisePose(shoulderAngle) {
  const lms = blank();
  const H = { x: 0.5, y: 0.65 };
  const S = { x: 0.5, y: 0.35 };
  const La = 0.14;
  const a = rad(180 - shoulderAngle);
  const E = { x: S.x + La * Math.sin(a), y: S.y + La * Math.cos(a) };
  const W = { x: S.x + 2 * La * Math.sin(a), y: S.y + 2 * La * Math.cos(a) };
  for (const [off, base] of [[-0.03, 0], [0.03, 1]]) {
    put(lms, 23 + base, H.x + off, H.y);
    put(lms, 11 + base, S.x + off, S.y);
    put(lms, 13 + base, E.x + off, E.y);
    put(lms, 15 + base, W.x + off, W.y);
  }
  return lms;
}

/**
 * Landmarks at time tMs for a simulated session.
 * opts: periodMs, holdMs (balance), hideFromMs (body leaves frame), sag (push-up), twoPeople
 */
export function simFrame(kind, tMs, opts = {}) {
  const { periodMs = 2200, holdMs = 12000, hideFromMs = Infinity, sag = 0, twoPeople = false } = opts;
  let lms;
  if (kind === 'squat') lms = squatPose(170 - 90 * bell(tMs, periodMs));
  else if (kind === 'pushup') lms = pushupPose(172 - 87 * bell(tMs, periodMs), { sag });
  else if (kind === 'arm_raise') lms = armRaisePose(30 + 130 * bell(tMs, periodMs));
  else { const lift = tMs > 1500 && tMs < 1500 + holdMs ? 0.3 : 0; lms = standingPose(lift, true); }
  if (tMs >= hideFromMs) lms.forEach((p) => { p.visibility = 0.1; });
  return { lms, poses: twoPeople ? 2 : 1 };
}
