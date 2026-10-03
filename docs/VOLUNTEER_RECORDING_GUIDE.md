# KhelSetu: Volunteer Landmark Recording & Benchmarking Protocol

This protocol guides the collection of real-world volunteer landmark traces across varied devices, lighting, and attire without collecting or storing raw video.

---

## 1. Volunteer Target Cohort

* **Cohort Size**: 20–30 college student volunteers (aim for 50/50 gender split, varied fitness backgrounds).
* **Device Matrix**:
  - Tier 1: Budget Android (MediaTek Helio G35 / Snapdragon 680, 3–4GB RAM)
  - Tier 2: Mid-Range Android (Snapdragon 778G / Dimensity 7050, 6–8GB RAM)
  - Tier 3: Flagship Android (Snapdragon 8 Gen 2/3)
  - Tier 4: iOS Safari (iPhone 11 or later)

---

## 2. Step-by-Step Recording Procedure

1. **Consent & Verification**:
   - Verify volunteer is 18 years of age or older.
   - Explain that only 3D skeletal landmark coordinates ($x, y, z$) and timestamps are recorded; zero camera frames are saved.
2. **Setup & Device Calibration**:
   - Open KhelSetu in the browser with recorder mode enabled (`http://localhost:8000/?record=1`).
   - Prop device securely at a height of 0.3m – 1.0m, tilted slightly upward, at a distance of 1.8m – 2.5m.
3. **Session Protocol (30s per Exercise)**:
   - *Squats*: 30 seconds side view. Human counter marks total full squats (inflection $<105^\circ$).
   - *Push-ups*: 30 seconds side view. Human counter marks full push-ups and counts any sagging attempts.
   - *Single-Leg Balance*: Up to 30 seconds front view. Stop watch records exact foot-down timestamp.
4. **Trace Export**:
   - At the end of the test, click **"Export Landmark Trace"**.
   - Save JSON file to `tests/traces/vol_<id>_<exercise>_<tier>.json`.
   - Run `node scripts/eval_reps.mjs` to update campus MAE and off-by-one accuracy reports automatically.
