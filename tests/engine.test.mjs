import test from 'node:test';
import assert from 'node:assert/strict';
import { angle, angle3D, EMA, OneEuroFilter, RepTest, BalanceTest, baselineFrom, weeklyGoal, integrityVerdict } from '../frontend/engine.js';
import { simFrame, squatPose, pushupPose } from '../frontend/sim.js';

const FPS = 30;
function run(kind, opts, durationMs = 30000, testOpts = {}) {
  const t = new RepTest(kind, testOpts);
  for (let ms = 0; ms <= durationMs; ms += 1000 / FPS) {
    // human tempo varies a little; a perfectly uniform loop would (rightly) be flagged
    const f = simFrame(kind, ms + 180 * Math.sin(ms / 1700), opts);
    t.process(f.lms, ms, { poses: f.poses });
  }
  return t;
}

test('angle: right angle and straight line', () => {
  assert.ok(Math.abs(angle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }) - 90) < 1e-6);
  assert.ok(Math.abs(angle({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }) - 180) < 1e-6);
});

test('synthetic poses produce the intended joint angles', () => {
  const k = squatPose(90);
  assert.ok(Math.abs(angle(k[23], k[25], k[27]) - 90) < 1);
  const p = pushupPose(100);
  assert.ok(Math.abs(angle(p[11], p[13], p[15]) - 100) < 1);
  assert.ok(angle(p[11], p[23], p[27]) > 175);
});

test('squats: 2.2 s period over 30 s counts 13 reps (+/-1)', () => {
  const t = run('squat', { periodMs: 2200 });
  assert.ok(Math.abs(t.reps - 13) <= 1, `got ${t.reps}`);
  assert.equal(t.summary(30000).verdict, 'verified');
});

test('squats: jittery landmarks do not inflate the count', () => {
  const t = new RepTest('squat'); let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  for (let ms = 0; ms <= 30000; ms += 1000 / FPS) {
    const f = simFrame('squat', ms, { periodMs: 2200 });
    f.lms.forEach((p) => { p.x += rnd() * 0.006; p.y += rnd() * 0.006; });
    t.process(f.lms, ms, {});
  }
  assert.ok(Math.abs(t.reps - 13) <= 2, `got ${t.reps}`);
});

test('too-fast bouncing is rejected, not counted', () => {
  const t = run('squat', { periodMs: 600 });
  assert.ok(t.reps <= 18, `a 0.6 s period must not exceed the minimum-interval cap, got ${t.reps}`);
  assert.ok(t.rejected.length > 0);
});

test('push-ups with straight body count; sagging hips are rejected', () => {
  const good = run('pushup', { periodMs: 2000 });
  assert.ok(Math.abs(good.reps - 15) <= 1, `got ${good.reps}`);
  const bad = run('pushup', { periodMs: 2000, sag: 0.08 });
  assert.equal(bad.reps, 0);
  assert.ok(bad.rejected.length > 5 && bad.rejected.every((r) => r.reason === 'hips_sagging'));
});

test('integrity: body leaving frame halfway -> not verified', () => {
  const t = run('squat', { periodMs: 2200, hideFromMs: 12000 });
  assert.notEqual(t.summary(30000).verdict, 'verified');
});

test('integrity: second person in view -> invalid', () => {
  const t = run('squat', { periodMs: 2200, twoPeople: true });
  const s = t.summary(30000);
  assert.equal(s.verdict, 'invalid');
  assert.ok(s.reasons.includes('multiple_people'));
});

test('integrity: perfectly uniform tempo is flagged low_confidence', () => {
  const iv = integrityVerdict({ validFrames: 900, totalFrames: 900, repIntervals: [2000, 2000, 2000, 2001, 2000, 2000, 2000] });
  assert.equal(iv.verdict, 'low_confidence');
});

test('balance: measures a 12 s hold within 0.7 s', () => {
  const b = new BalanceTest();
  for (let ms = 0; ms <= 20000 && !b.done; ms += 1000 / FPS) { const f = simFrame('balance', ms, { holdMs: 12000 }); b.process(f.lms, ms, {}); }
  const s = b.summary();
  assert.ok(b.done);
  assert.equal(s.endReason, 'foot_down');
  assert.ok(Math.abs(s.value - 12000) < 700, `got ${s.value}`);
});

test('balance: no attempt times out with 0 hold', () => {
  const b = new BalanceTest();
  for (let ms = 0; ms <= 20000 && !b.done; ms += 1000 / FPS) { const f = simFrame('balance', ms, { holdMs: 0 }); b.process(f.lms, ms, {}); }
  assert.equal(b.summary().value, 0);
  assert.equal(b.summary().endReason, 'no_attempt');
});

test('baseline bands and goal ramp never exceed the 150 min cap', () => {
  const low = baselineFrom({ squat: 5, pushup: 2, balanceMs: 4000 });
  assert.equal(low.band, 'starter');
  const high = baselineFrom({ squat: 30, pushup: 20, balanceMs: 30000 });
  assert.equal(high.band, 'strong');
  assert.equal(weeklyGoal('starter', 0), 60);
  assert.ok(weeklyGoal('starter', 4) > 60 && weeklyGoal('starter', 4) <= 150);
  assert.equal(weeklyGoal('strong', 10), 150);
  assert.equal(weeklyGoal('strong', 10, true), 90);
});

test('OneEuroFilter: smooths jitter while responding to sudden transitions', () => {
  const f = new OneEuroFilter(1.0, 0.007);
  // Stationary jitter
  let out1 = f.push(100, 0);
  let out2 = f.push(102, 33);
  assert.ok(Math.abs(out2 - 100) < 1.5, 'jitter should be damped');
  // Fast jump
  let outJump = f.push(180, 66);
  assert.ok(outJump > 120, 'fast transition should break through filter');
});

test('angle3D: 3D perpendicular vectors produce 90 degrees', () => {
  const deg = angle3D({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  assert.ok(Math.abs(deg - 90) < 1e-6);
});

test('RepTest with One-Euro filter counts 13 squats accurately', () => {
  const t = run('squat', { periodMs: 2200 }, 30000, { filterType: 'one_euro' });
  assert.ok(Math.abs(t.reps - 13) <= 1, `got ${t.reps}`);
  assert.equal(t.summary(30000).verdict, 'verified');
});

test('arm_raise: seated arm raise counts 13 reps accurately', () => {
  const t = run('arm_raise', { periodMs: 2200 }, 30000);
  assert.ok(Math.abs(t.reps - 13) <= 1, `got ${t.reps}`);
  assert.equal(t.summary(30000).verdict, 'verified');
});


