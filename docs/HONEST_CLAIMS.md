# KhelSetu: Honest Claims & Scope Boundaries

KhelSetu is an offline-first fitness assistance and collegiate engagement platform built for Smart India Hackathon problem statement SIH26196. We adhere to strict scientific honesty: we never overclaim, invent accuracy metrics, or misrepresent security/privacy primitives.

---

## What We DO Claim (Supported by Code & Tests)

1. **On-Device Edge Vision Processing**:
   - MediaPipe PoseLandmarker Lite runs in-memory on the client via WebAssembly.
   - Raw video frames and camera pixels **never** leave the browser, are never stored to disk, and are never transmitted over the network.
   - Only scalar derived metrics (e.g. rep counts, hold durations, integrity confidence scores) are stored in the local append-only event log.

2. **Offline-First Resilience**:
   - The entire core loop (FitCheck, rep counting, local active minute tracking, goal progression, Hindi/English UI) works without an internet connection once the PWA shell and model are cached.
   - Events are stored in client IndexedDB with client-generated UUIDs, enabling idempotent eventual-consistency synchronization when online.

3. **Fairness-Designed Squad Scoring**:
   - Squad scores are computed as the **mean percentage of individual goal achievement**, rather than raw reps or total minutes.
   - Individual raw metrics (reps, hold times, BMI) are never shared across squad members; members only see mutual goal completion percentages.
   - Daily credited minutes are capped at 60 minutes/day as a design safeguard against burnout and cramming.

4. **$k$-Anonymity Campus Dashboard ($k \ge 10$)**:
   - Cohorts with fewer than 10 students are suppressed and merged into an aggregate "Other" pool.
   - If the aggregate "Other" pool also has fewer than 10 students, it is fully suppressed.
   - Aggregated views do not display exact unrounded campus totals that would allow re-identifying suppressed cohorts through subtraction (differencing defense).

5. **DPDP-Aligned Data Minimization**:
   - Pilot deployments are strictly gated to students aged 18 and older to prevent unverified minor data processing.
   - Health screening (PAR-Q) evaluates locally; only the binary readiness outcome (*cleared* vs *gentle*) is transmitted.
   - Full data export (`/api/me/export`) and irreversible data erasure (`/api/me/delete`) are functional.

---

## What We DO NOT Claim (Explicit Non-Claims)

1. **Not a Medical Device or Diagnostic Tool**:
   - KhelSetu provides fitness assistance, movement habits, and motivation. It does not diagnose cardiovascular conditions, prescribe clinical rehabilitation, or guarantee injury prevention.
2. **Not "Cheat-Proof"**:
   - The integrity gate uses heuristics (joint visibility, tempo variance, min rep duration, single-person frame detection) that make logs **tamper-evident** and flag suspicious attempts for review. It does not claim mathematical immunity against dedicated adversarial spoofing.
3. **Not Medically Proven 60-Minute Limits**:
   - The 60-minute daily credit cap is a **gameplay fairness and anti-burnout design choice**, not a clinically validated maximum physical exertion threshold.
4. **Not Population-Wide Norms**:
   - Baseline bands (*Starter, Building, Steady, Strong*) use provisional thresholds. No open, centralized normative percentile dataset exists for Indian university students; our pilot baseline will be the first measured collegiate reference.
5. **Not "JWT Stateless Production Auth" / "Database RLS"**:
   - The current MVP uses HMAC-signed session tokens and tenant-scoped SQLite queries (`institution_id` filtering in every query). Full JWT rotation and PostgreSQL Row-Level Security (RLS) are architectural targets for multi-campus production.
6. **No Fabricated Accuracy Statistics**:
   - We do not quote arbitrary percentages (e.g. "99% accurate rep counting"). All accuracy figures (MAE, off-by-one) are computed strictly through the replay evaluation harness on recorded traces.
