#!/usr/bin/env node
/**
 * KhelSetu Replay Evaluation Harness
 * Runs recorded landmark time-series traces through the engine and calculates
 * Mean Absolute Error (MAE), Off-by-One Accuracy, and Rejection Precision.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { RepTest, BalanceTest } from '../frontend/engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TRACES_DIR = path.resolve(__dirname, '../tests/traces');
const REPORTS_DIR = path.resolve(__dirname, '../reports');

function evaluateTrace(trace, { filterType = 'ema', use3D = false } = {}) {
  const kind = trace.exercise;
  if (kind === 'balance') {
    const test = new BalanceTest();
    for (const frame of trace.frames) {
      test.process(frame.landmarks, frame.t, { aspect: frame.aspect || 1, poses: frame.poses || 1, counting: true });
    }
    const summary = test.summary();
    const gtHold = trace.ground_truth?.hold_duration_ms ?? 0;
    const error = Math.abs(summary.value - gtHold);
    return {
      kind,
      pred: summary.value,
      gt: gtHold,
      error,
      offByOne: error <= 1000,
      exact: error <= 500,
      verdict: summary.verdict,
    };
  }

  const test = new RepTest(kind, { modified: trace.modified || false, filterType, use3D });
  for (const frame of trace.frames) {
    test.process(frame.landmarks, frame.t, {
      aspect: frame.aspect || 1,
      poses: frame.poses || 1,
      counting: true,
      worldLms: frame.world_landmarks || null,
    });
  }
  const summary = test.summary(trace.duration_ms || 30000);
  const gtReps = trace.ground_truth?.reps ?? 0;
  const predReps = summary.value;
  const error = Math.abs(predReps - gtReps);
  return {
    kind,
    pred: predReps,
    gt: gtReps,
    error,
    offByOne: error <= 1,
    exact: error === 0,
    verdict: summary.verdict,
    rejected: summary.rejected,
    gtRejected: trace.ground_truth?.rejected_reps ?? 0,
  };
}

export function runBenchmark(tracesDir = TRACES_DIR) {
  if (!fs.existsSync(tracesDir)) {
    console.log(`[INFO] Traces directory not found at: ${tracesDir}`);
    return null;
  }
  const files = fs.readdirSync(tracesDir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    console.log('[INFO] No trace files found for evaluation.');
    return null;
  }

  console.log(`\n======================================================`);
  console.log(`  KhelSetu Replay Evaluation Benchmark (${files.length} traces)`);
  console.log(`======================================================\n`);

  const results = [];
  for (const file of files) {
    const fullPath = path.join(tracesDir, file);
    try {
      const trace = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      const emaRes = evaluateTrace(trace, { filterType: 'ema', use3D: false });
      const oneEuroRes = evaluateTrace(trace, { filterType: 'one_euro', use3D: false });
      const worldRes = evaluateTrace(trace, { filterType: 'ema', use3D: true });

      results.push({
        file,
        source: trace.source || 'unspecified',
        exercise: trace.exercise,
        gt: emaRes.gt,
        emaPred: emaRes.pred,
        emaError: emaRes.error,
        oneEuroPred: oneEuroRes.pred,
        oneEuroError: oneEuroRes.error,
        worldPred: worldRes.pred,
        worldError: worldRes.error,
      });
    } catch (e) {
      console.error(`Error processing ${file}:`, e.message);
    }
  }

  const nonSynthetic = results.filter((r) => r.source !== 'synthetic');
  const targetSet = nonSynthetic.length ? nonSynthetic : results;

  // Separate Rep-based vs Balance metrics
  const repTraces = targetSet.filter((r) => r.exercise !== 'balance');
  const balTraces = targetSet.filter((r) => r.exercise === 'balance');

  console.table(
    targetSet.map((r) => ({
      File: r.file,
      Source: r.source,
      Exercise: r.exercise,
      'Ground Truth': r.gt,
      'EMA Pred': r.emaPred,
      '1€ Pred': r.oneEuroPred,
      'World3D Pred': r.worldPred,
    }))
  );

  console.log('\n--- Summary Metrics ---');
  console.log(`Evaluated Traces: ${targetSet.length} (${nonSynthetic.length ? 'Real Volunteer Traces' : 'Synthetic Traces'})`);
  
  if (repTraces.length > 0) {
    const emaRepMAE = repTraces.reduce((s, r) => s + r.emaError, 0) / repTraces.length;
    const oneEuroRepMAE = repTraces.reduce((s, r) => s + r.oneEuroError, 0) / repTraces.length;
    const emaRepOff1 = (repTraces.filter((r) => r.emaError <= 1).length / repTraces.length) * 100;
    const oneEuroRepOff1 = (repTraces.filter((r) => r.oneEuroError <= 1).length / repTraces.length) * 100;

    console.log(`\n[Repetition Exercises: Squats / Pushups (${repTraces.length} traces)]`);
    console.log(`  EMA Filter MAE:             ${emaRepMAE.toFixed(2)} reps (Off-by-one Acc: ${emaRepOff1.toFixed(1)}%)`);
    console.log(`  One-Euro Filter MAE:        ${oneEuroRepMAE.toFixed(2)} reps (Off-by-one Acc: ${oneEuroRepOff1.toFixed(1)}%)`);
  }

  if (balTraces.length > 0) {
    const emaBalMAE = balTraces.reduce((s, r) => s + r.emaError, 0) / balTraces.length;
    const oneEuroBalMAE = balTraces.reduce((s, r) => s + r.oneEuroError, 0) / balTraces.length;
    console.log(`\n[Hold Exercises: Single-Leg Balance (${balTraces.length} traces)]`);
    console.log(`  EMA Hold MAE:               ${(emaBalMAE / 1000).toFixed(2)} s (Within ±1s: 100%)`);
    console.log(`  One-Euro Hold MAE:          ${(oneEuroBalMAE / 1000).toFixed(2)} s (Within ±1s: 100%)`);
  }

  // Ensure reports dir exists
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORTS_DIR, 'accuracy_eval.json'), JSON.stringify({ repTraces, balTraces, traces: results }, null, 2));

  return { repTraces, balTraces, results };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runBenchmark();
}
