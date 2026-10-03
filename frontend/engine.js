// KhelSetu FitCheck engine. Pure logic: no DOM, no camera. Runs in browser and Node (tests).
// Input: MediaPipe pose landmarks (33 points, normalised x/y in [0,1], optional `visibility`).
// Evidence labels used in comments: [D] design decision, [A] assumption to calibrate in pilot.

export const LM = {
  L_SHOULDER: 11, R_SHOULDER: 12, L_ELBOW: 13, R_ELBOW: 14, L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26, L_ANKLE: 27, R_ANKLE: 28,
};

// ---------- geometry ----------
const vis = (p) => (p && p.visibility !== undefined ? p.visibility : 1);
const inFrame = (p) => p && p.x > -0.03 && p.x < 1.03 && p.y > -0.03 && p.y < 1.03;

/** Interior angle at b (degrees). x is scaled by aspect so angles are not distorted by non-square video. */
export function angle(a, b, c, aspect = 1) {
  const v1x = (a.x - b.x) * aspect, v1y = a.y - b.y;
  const v2x = (c.x - b.x) * aspect, v2y = c.y - b.y;
  const m = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (m < 1e-9) return NaN;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / m));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** 3D Euclidean interior angle at b (degrees) for MediaPipe world landmarks (metric coords). */
export function angle3D(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y, v1z = (a.z ?? 0) - (b.z ?? 0);
  const v2x = c.x - b.x, v2y = c.y - b.y, v2z = (c.z ?? 0) - (b.z ?? 0);
  const dot = v1x * v2x + v1y * v2y + v1z * v2z;
  const m = Math.hypot(v1x, v1y, v1z) * Math.hypot(v2x, v2y, v2z);
  if (m < 1e-9) return NaN;
  const cos = Math.max(-1, Math.min(1, dot / m));
  return (Math.acos(cos) * 180) / Math.PI;
}

const dist = (a, b, aspect = 1) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);

export class EMA {
  constructor(alpha = 0.45) { this.a = alpha; this.v = null; }
  push(x) { this.v = this.v === null ? x : this.a * x + (1 - this.a) * this.v; return this.v; }
  reset() { this.v = null; }
}

/** 1€ adaptive filter: low lag during fast transitions, minimal jitter at rest (Casiez et al. 2012). */
export class OneEuroFilter {
  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.xPrev = null; this.dxPrev = 0; this.tPrev = null;
  }
  _alpha(cutoff, dt) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }
  push(x, t) {
    if (this.tPrev === null || t === undefined) {
      this.xPrev = x; this.tPrev = t ?? 0; this.dxPrev = 0; return x;
    }
    const dt = Math.max(1e-3, (t - this.tPrev) / 1000);
    this.tPrev = t;
    const dx = (x - (this.xPrev ?? x)) / dt;
    const edx = this._alpha(this.dCutoff, dt) * dx + (1 - this._alpha(this.dCutoff, dt)) * this.dxPrev;
    this.dxPrev = edx;
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const a = this._alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * (this.xPrev ?? x);
    this.xPrev = xHat;
    return xHat;
  }
  reset() { this.xPrev = null; this.dxPrev = 0; this.tPrev = null; }
}

/** Mean visibility of a list of landmark indices; also whether all are inside the frame. */
function sideQuality(lms, idxs) {
  let s = 0, ok = true;
  for (const i of idxs) { s += vis(lms[i]); if (!inFrame(lms[i])) ok = false; }
  return { vis: s / idxs.length, inFrame: ok };
}

// ---------- test configuration ----------
// [A] thresholds are starting values to be tuned on the day-1 spike and pilot data.
export const TEST_CONFIG = {
  squat:     { downAngle: 105, upAngle: 160, minRepMs: 500, minIntervalMs: 900,  durationMs: 30000, minVis: 0.5 },
  pushup:    { downAngle: 95,  upAngle: 155, minRepMs: 400, minIntervalMs: 700,  durationMs: 30000, minVis: 0.5, minBodyLine: 160 },
  arm_raise: { downAngle: 70,  upAngle: 140, minRepMs: 400, minIntervalMs: 700,  durationMs: 30000, minVis: 0.5 },
  balance:   { liftRatio: 0.12, downRatio: 0.06, driftRatio: 0.25, holdStartMs: 400, maxMs: 30000, waitMs: 15000, minVis: 0.5 },
};

// ---------- integrity gate ----------
/** Turns frame statistics into a verdict. Verdicts: verified | low_confidence | invalid. */
export function integrityVerdict({ validFrames, totalFrames, multiPersonFrames = 0, repIntervals = [] }) {
  const reasons = [];
  const ratio = totalFrames ? validFrames / totalFrames : 0;
  let verdict = 'verified';
  if (totalFrames < 10) { verdict = 'invalid'; reasons.push('too_few_frames'); }
  if (ratio < 0.6) { verdict = 'invalid'; reasons.push('body_not_visible'); }
  else if (ratio < 0.85) { if (verdict === 'verified') verdict = 'low_confidence'; reasons.push('body_partly_visible'); }
  if (totalFrames && multiPersonFrames / totalFrames > 0.1) { verdict = 'invalid'; reasons.push('multiple_people'); }
  if (repIntervals.length >= 6) {
    const mean = repIntervals.reduce((a, b) => a + b, 0) / repIntervals.length;
    const sd = Math.sqrt(repIntervals.reduce((a, b) => a + (b - mean) ** 2, 0) / repIntervals.length);
    if (mean > 0 && sd / mean < 0.02) { if (verdict === 'verified') verdict = 'low_confidence'; reasons.push('unnaturally_uniform_tempo'); }
  }
  return { verdict, reasons, confidence: Math.round(ratio * 100) / 100 };
}

// ---------- rep tests (squat / push-up / arm raise) ----------
export class RepTest {
  constructor(kind, { modified = false, filterType = 'ema', use3D = false } = {}) {
    if (!TEST_CONFIG[kind] || kind === 'balance') throw new Error('RepTest kind must be squat, pushup, or arm_raise');
    this.kind = kind; this.cfg = TEST_CONFIG[kind]; this.modified = modified;
    this.filterType = filterType; this.use3D = use3D;
    this.reset();
  }
  reset() {
    this.filter = this.filterType === 'one_euro' ? new OneEuroFilter(1.0, 0.007) : new EMA();
    this.phase = 'unknown'; this.reps = 0; this.rejected = [];
    this.validFrames = 0; this.totalFrames = 0; this.multiPersonFrames = 0;
    this.downStart = 0; this.minAngle = 180; this.minBody = 180; this.lastRepT = null;
    this.intervals = []; this.invalidSince = null; this.lastAngle = null; this.repTimes = [];
  }
  /** Which side of the body to read (the more visible one) and whether the frame is usable. */
  _pick(lms) {
    let sets;
    if (this.kind === 'squat') {
      sets = { L: [LM.L_HIP, LM.L_KNEE, LM.L_ANKLE], R: [LM.R_HIP, LM.R_KNEE, LM.R_ANKLE] };
    } else if (this.kind === 'arm_raise') {
      sets = { L: [LM.L_HIP, LM.L_SHOULDER, LM.L_ELBOW, LM.L_WRIST], R: [LM.R_HIP, LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST] };
    } else {
      sets = { L: [LM.L_SHOULDER, LM.L_ELBOW, LM.L_WRIST, LM.L_HIP, LM.L_ANKLE], R: [LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST, LM.R_HIP, LM.R_ANKLE] };
    }
    const l = sideQuality(lms, sets.L), r = sideQuality(lms, sets.R);
    const useL = l.vis >= r.vis; const q = useL ? l : r;
    return { side: useL ? 'L' : 'R', ok: q.vis >= this.cfg.minVis && q.inFrame, vis: q.vis };
  }
  _angles(lms, side, aspect, worldLms) {
    const useWorld = this.use3D && worldLms && worldLms.length >= 29;
    const srcLms = useWorld ? worldLms : lms;
    const g = (n) => srcLms[LM[`${side}_${n}`]];
    if (useWorld) {
      if (this.kind === 'squat') return { main: angle3D(g('HIP'), g('KNEE'), g('ANKLE')) };
      if (this.kind === 'arm_raise') return { main: angle3D(g('HIP'), g('SHOULDER'), g('ELBOW')) };
      return {
        main: angle3D(g('SHOULDER'), g('ELBOW'), g('WRIST')),
        body: angle3D(g('SHOULDER'), g('HIP'), g('ANKLE')),
      };
    }
    if (this.kind === 'squat') return { main: angle(g('HIP'), g('KNEE'), g('ANKLE'), aspect) };
    if (this.kind === 'arm_raise') return { main: angle(g('HIP'), g('SHOULDER'), g('ELBOW'), aspect) };
    return {
      main: angle(g('SHOULDER'), g('ELBOW'), g('WRIST'), aspect),
      body: angle(g('SHOULDER'), g('HIP'), g('ANKLE'), aspect),
    };
  }
  /** Feed one frame. `counting=false` during countdown (state tracked, reps not counted). */
  process(lms, t, { aspect = 1, poses = 1, counting = true, worldLms = null } = {}) {
    const out = { phase: this.phase, reps: this.reps, angle: this.lastAngle, valid: false, hint: null, event: null };
    if (counting) { this.totalFrames++; if (poses > 1) this.multiPersonFrames++; }
    if (!lms || lms.length < 29) { out.hint = 'no_person'; return this._invalid(out, t); }
    const pick = this._pick(lms);
    if (!pick.ok) { out.hint = pick.vis < this.cfg.minVis ? 'body_not_visible' : 'step_back'; return this._invalid(out, t); }
    const a = this._angles(lms, pick.side, aspect, worldLms);
    if (Number.isNaN(a.main)) { out.hint = 'body_not_visible'; return this._invalid(out, t); }
    this.invalidSince = null;
    if (counting) this.validFrames++;
    const sm = this.filter.push(a.main, t); this.lastAngle = sm; out.angle = sm; out.valid = true;
    if (this.kind === 'pushup' && a.body !== undefined && this.phase === 'down') this.minBody = Math.min(this.minBody, a.body);
    const { downAngle, upAngle } = this.cfg;

    if (this.phase === 'unknown') {
      if (this.kind === 'arm_raise') {
        if (sm < downAngle) this.phase = 'down';
        else out.hint = 'arms_down';
      } else {
        if (sm > upAngle) this.phase = 'up';
        else out.hint = this.kind === 'squat' ? 'stand_tall' : 'arms_straight';
      }
    } else if (this.kind === 'arm_raise') {
      // For arm raise: starting at 'down' (arms at sides), reaching 'up' (arms raised overhead > upAngle), returning 'down' (< downAngle)
      if (this.phase === 'down') {
        if (sm > upAngle) { this.phase = 'up'; this.downStart = t; }
      } else if (this.phase === 'up') {
        if (sm < downAngle) {
          this.phase = 'down';
          const dur = t - this.downStart;
          let reject = null;
          if (dur < this.cfg.minRepMs) reject = 'too_fast';
          else if (this.lastRepT !== null && t - this.lastRepT < this.cfg.minIntervalMs) reject = 'too_fast';
          if (reject) { if (counting) { this.rejected.push({ t, reason: reject }); out.event = { rejected: reject }; } }
          else if (counting) {
            if (this.lastRepT !== null) this.intervals.push(t - this.lastRepT);
            this.lastRepT = t; this.reps++; this.repTimes.push(t); out.event = { rep: this.reps };
          }
        }
      }
    } else if (this.phase === 'up') {
      if (sm < downAngle) { this.phase = 'down'; this.downStart = t; this.minAngle = sm; this.minBody = a.body ?? 180; }
    } else if (this.phase === 'down') {
      this.minAngle = Math.min(this.minAngle, sm);
      if (sm > upAngle) {
        this.phase = 'up';
        const dur = t - this.downStart;
        let reject = null;
        if (dur < this.cfg.minRepMs) reject = 'too_fast';
        else if (this.lastRepT !== null && t - this.lastRepT < this.cfg.minIntervalMs) reject = 'too_fast';
        else if (this.kind === 'pushup' && this.minBody < this.cfg.minBodyLine) reject = 'hips_sagging';
        if (reject) { if (counting) { this.rejected.push({ t, reason: reject }); out.event = { rejected: reject }; } }
        else if (counting) {
          if (this.lastRepT !== null) this.intervals.push(t - this.lastRepT);
          this.lastRepT = t; this.reps++; this.repTimes.push(t); out.event = { rep: this.reps };
        }
      }
    }
    out.phase = this.phase; out.reps = this.reps; return out;
  }
  _invalid(out, t) {
    if (this.invalidSince === null) this.invalidSince = t;
    // Lost the body mid-rep for >0.5 s: abandon that rep, require a clean return to ready state.
    if ((this.phase === 'down' || this.phase === 'up') && t - this.invalidSince > 500) this.phase = 'unknown';
    out.phase = this.phase; return out;
  }
  summary(durationMs) {
    const iv = integrityVerdict({ validFrames: this.validFrames, totalFrames: this.totalFrames, multiPersonFrames: this.multiPersonFrames, repIntervals: this.intervals });
    return { kind: this.kind, value: this.reps, unit: 'reps', durationMs, rejected: this.rejected.length, rejectedReasons: this.rejected.map((r) => r.reason), modified: this.modified, ...iv };
  }
}

// ---------- single-leg balance ----------
export class BalanceTest {
  constructor() { this.cfg = TEST_CONFIG.balance; this.reset(); }
  reset() {
    this.state = 'waiting'; this.liftSince = null; this.holdStart = null; this.standX = null; this.standSide = null;
    this.done = false; this.holdMs = 0; this.endReason = null; this.waitStart = null;
    this.validFrames = 0; this.totalFrames = 0; this.multiPersonFrames = 0; this.ema = new EMA(0.5); this.lostSince = null;
  }
  process(lms, t, { aspect = 1, poses = 1, counting = true } = {}) {
    const out = { state: this.state, holdMs: this.holdMs, done: this.done, valid: false, hint: null };
    if (this.done) return out;
    if (this.waitStart === null) this.waitStart = t;
    if (counting) { this.totalFrames++; if (poses > 1) this.multiPersonFrames++; }
    const need = [LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE];
    if (!lms || lms.length < 29) { out.hint = 'no_person'; return this._timeoutCheck(out, t); }
    const q = sideQuality(lms, need);
    if (q.vis < this.cfg.minVis || !q.inFrame) { out.hint = q.inFrame ? 'body_not_visible' : 'step_back'; return this._timeoutCheck(out, t, true); }
    if (counting) this.validFrames++;
    this.lostSince = null;
    out.valid = true;
    const la = lms[LM.L_ANKLE], ra = lms[LM.R_ANKLE];
    const legLen = (dist(lms[LM.L_HIP], la, aspect) + dist(lms[LM.R_HIP], ra, aspect)) / 2;
    if (legLen < 1e-6) return out;
    const dy = this.ema.push(la.y - ra.y); // y grows downward: smaller y = higher foot
    const lift = Math.abs(dy) / legLen;
    const liftedIsLeft = dy < 0;

    if (this.state === 'waiting') {
      out.hint = 'lift_one_foot';
      if (lift > this.cfg.liftRatio) {
        if (this.liftSince === null) this.liftSince = t;
        if (t - this.liftSince >= this.cfg.holdStartMs) {
          this.state = 'holding'; this.holdStart = this.liftSince; this.standSide = liftedIsLeft ? 'R' : 'L';
          this.standX = (liftedIsLeft ? ra.x : la.x) * aspect;
        }
      } else this.liftSince = null;
      if (t - this.waitStart > this.cfg.waitMs) return this._finish(out, t, 'no_attempt');
    } else if (this.state === 'holding') {
      const standX = (this.standSide === 'L' ? la.x : ra.x) * aspect;
      const drift = Math.abs(standX - this.standX) / legLen;
      this.holdMs = Math.max(0, t - this.holdStart);
      if (lift < this.cfg.downRatio) return this._finish(out, t, 'foot_down');
      if (drift > this.cfg.driftRatio) return this._finish(out, t, 'hopped');
      if (this.holdMs >= this.cfg.maxMs) { this.holdMs = this.cfg.maxMs; return this._finish(out, t, 'max_reached'); }
    }
    out.state = this.state; out.holdMs = this.holdMs; return out;
  }
  _timeoutCheck(out, t) {
    if (this.state === 'waiting' && t - this.waitStart > this.cfg.waitMs) return this._finish(out, t, 'no_attempt');
    // Lost visibility while holding for > 1 s ends the hold at the last good time.
    if (this.state === 'holding') {
      if (this.lostSince === null) this.lostSince = t;
      if (t - this.lostSince > 1000) return this._finish(out, t, 'lost_body');
    }
    return out;
  }
  _finish(out, t, reason) {
    this.done = true; this.state = 'done'; this.endReason = reason; out.done = true; out.state = 'done'; out.holdMs = this.holdMs; return out;
  }
  summary() {
    const iv = integrityVerdict({ validFrames: this.validFrames, totalFrames: this.totalFrames, multiPersonFrames: this.multiPersonFrames });
    return { kind: 'balance', value: Math.round(this.holdMs), unit: 'ms', endReason: this.endReason, ...iv };
  }
}

// ---------- baseline, bands, goals ----------
// [A] PROVISIONAL. No public Indian college-student norms were found (see research dossier), so these
// reference values are placeholders used only to scale a personal starting goal. Calibrate with pilot data.
export const PROVISIONAL_REFERENCE = { squat: 25, pushup: 15, pushupModified: 20, balanceMs: 30000, armRaise: 20 };
export const BANDS = [
  { key: 'starter', max: 25 }, { key: 'building', max: 50 }, { key: 'steady', max: 75 }, { key: 'strong', max: 101 },
];
export const START_MINUTES = { starter: 60, building: 90, steady: 120, strong: 150 }; // [D] ramp toward, never beyond, 150
export const WEEKLY_CAP_MINUTES = 150; // lower bound of the WHO 150-300 min/week adult guidance
export const GENTLE_CAP_MINUTES = 90;  // [D] if screening suggested checking with a doctor first
export const WEEKLY_RAMP = 1.1;

/** results: {squat?, pushup?, balanceMs?, armRaise?, modifiedPushup?} -> {index 0-100, band} using only completed tests */
export function baselineFrom(results) {
  const parts = [];
  if (results.squat != null) parts.push(Math.min(1, results.squat / PROVISIONAL_REFERENCE.squat));
  if (results.pushup != null) parts.push(Math.min(1, results.pushup / (results.modifiedPushup ? PROVISIONAL_REFERENCE.pushupModified : PROVISIONAL_REFERENCE.pushup)));
  if (results.balanceMs != null) parts.push(Math.min(1, results.balanceMs / PROVISIONAL_REFERENCE.balanceMs));
  if (results.arm_raise != null || results.armRaise != null) parts.push(Math.min(1, (results.arm_raise ?? results.armRaise) / PROVISIONAL_REFERENCE.armRaise));
  if (!parts.length) return null;
  const index = Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100);
  const band = BANDS.find((b) => index < b.max).key;
  return { index, band };
}

/** Weekly active-minute goal. weeksSinceStart = 0 for the first week. */
export function weeklyGoal(band, weeksSinceStart = 0, gentle = false) {
  const cap = gentle ? GENTLE_CAP_MINUTES : WEEKLY_CAP_MINUTES;
  const start = Math.min(START_MINUTES[band] ?? 60, cap);
  return Math.min(cap, Math.round((start * WEEKLY_RAMP ** Math.max(0, weeksSinceStart)) / 5) * 5);
}

// Daily credit cap and manual-entry weight (mirrored on the server). [D]
export const DAILY_CREDIT_CAP_MIN = 60;
export const UNVERIFIED_WEIGHT = 0.5;
