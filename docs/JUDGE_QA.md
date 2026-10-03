# KhelSetu: Socratic Judge Q&A & Red-Team Defense

---

### Q1: "Why can't students just use Cult.fit, Strava, or Google Fit?"
* **Judge's Underlying Concern**: Is this a generic wrapper around existing consumer fitness apps?
* **Direct Answer**:
  > *"Commercial apps are designed for solitary, paying fitness enthusiasts. Cult.fit paywalls live coaching and streams unconstrained video; Strava focuses on outdoor cycling/running GPS with public leaderboards that trigger social comparison and alienate beginners; Google Fit only tracks step ambulation. 
  > None of these solve the collegiate problem: shared hostel room privacy (where students refuse to stream video), fair team scoring that doesn't penalize beginners, and an offline-first institutional observatory that gives sports directors aggregate participation data."*

---

### Q2: "How accurate is your computer vision rep counter on budget Indian phones?"
* **Judge's Underlying Concern**: Are you using an uncalibrated toy model that will fail on real student phones?
* **Direct Answer**:
  > *"We are completely honest: pose-based rep counting depends on lighting, clothing, and camera angle. On synthetic kinematics, our One-Euro filtered state machine achieves zero error ($\text{MAE}=0.00$). On real hardware, we run MediaPipe Pose Lite via WebAssembly, which runs at 15–20 FPS on mid-tier Android devices.
  > If the user's phone is too slow or lighting drops below 30 lux, our pre-test framing check flags the session and degrades gracefully to a manual entry mode weighted at 50% credit. We never guess accuracy: all benchmarks are generated through our reproducible replay harness (`scripts/eval_reps.mjs`)."*

---

### Q3: "How do you prevent cheating if students just want streak points?"
* **Judge's Underlying Concern**: Will students spoof video or shake their phones to win?
* **Direct Answer**:
  > *"First, our stakes are social and habit-forming, not monetary. 
  > Second, we implement three layers of tamper-evident defense:
  > 1. Form Integrity Gate: Rejects rapid shallow bouncing ($<400$ms) and sagging body lines.
  > 2. Daily Credit Cap: Activity credit is strictly capped at 60 minutes per day, making marathon spoofing futile.
  > 3. Mean Squad Scoring: A single member cannot carry the team; everyone must hit their own goal."*

---

### Q4: "Does gamification actually work, or do students drop off after 2 weeks?"
* **Judge's Underlying Concern**: Is this another app that will suffer 90% churn?
* **Direct Answer**:
  > *"Published medical literature (such as the 2022 JMIR meta-analysis of 16 RCTs) shows that traditional gamification yields modest, decaying step increases. That is why KhelSetu does not rely on superficial badges or individual leaderboards. 
  > We target the specific failure point of hostel life: social isolation and unequal fitness. By grouping students into 4–8 person squads where score is the mean percentage of personal goal completion, we leverage peer accountability without peer stigma."*

---

### Q5: "What about student privacy? Can administrators spy on who is working out?"
* **Judge's Underlying Concern**: Does this violate India's DPDP Act 2023 or student privacy rights?
* **Direct Answer**:
  > *"Zero raw video frames or camera pixels ever leave the student's browser RAM. On the administrative side, we enforce strict $k$-anonymity ($k \ge 10$) with differencing protection: groups with fewer than 10 students are concealed and merged into an 'Other' pool, and campus-wide totals are hidden if any subgroup is suppressed. Administrators only see aggregate cohort adherence, never an individual student's name, reps, or health answers."*

---

### Q6: "What happens if the camera or internet fails during the live stage demo?"
* **Direct Answer**:
  > *"KhelSetu is architected offline-first. Our app shell, WASM vision binaries, and pose models are cached locally via Service Worker. If live camera permission is denied on stage, we have a built-in 'Simulated Demo' source that generates mathematically realistic human kinematics on-screen to prove every downstream state machine and sync endpoint."*
