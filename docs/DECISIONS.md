# KhelSetu: Architectural Decision Records (ADRs)

---

### ADR-001: Zero Video Ingestion & On-Device WebAssembly Inference
* **Status**: Accepted
* **Context**: Video upload introduces insurmountable privacy risks in collegiate hostels, massive server GPU hosting costs, and bandwidth failure during high network congestion.
* **Decision**: Run MediaPipe PoseLandmarker Lite directly on the client browser via WebAssembly (`FilesetResolver`). Video streams remain in volatile memory and are discarded immediately after frame inference.
* **Consequences**: Server costs drop to minimal REST JSON storage; users can exercise in shared dorm rooms using Silhouette Mode with zero privacy compromise.

---

### ADR-002: Mean-Based Squad Completion Scoring & Daily Credit Caps
* **Status**: Accepted
* **Context**: Standard leaderboards reward already-fit students and demoralize beginners or inactive students who can only exercise 10 minutes a day.
* **Decision**: Squad streaks calculate the **mean percentage of each member's personal goal achieved**, not raw reps or minutes. Credit is capped at 60 mins/day.
* **Consequences**: Every student's effort contributes equally regardless of initial fitness level. Eliminates "lone carry" dynamics where one athlete inflates the entire squad's score.

---

### ADR-003: $k$-Anonymity with Total Differencing Defense ($k \ge 10$)
* **Status**: Accepted
* **Context**: Reporting exact campus totals alongside visible cohort rows allows an administrator to isolate small suppressed groups by subtraction ($N_{\text{total}} - \sum N_{\text{visible}} = N_{\text{hidden}}$).
* **Decision**: Suppress campus-wide totals whenever any constituent subgroup is suppressed. Small groups are aggregated into an "Other" pool, which itself is concealed if below $k=10$.
* **Consequences**: Prevents reconstruction of individual or small-cohort fitness records from dashboard queries.

---

### ADR-004: Event-Sourced Append-Only IndexedDB Sync
* **Status**: Accepted
* **Context**: Intermittent hostel Wi-Fi and mobile connectivity must not cause workout data loss or complex multi-master merge conflicts.
* **Decision**: All client actions create immutable, timestamped events with client-generated UUIDs (`id: uuid()`). The server performs idempotent `INSERT OR IGNORE` batch ingestion.
* **Consequences**: Offline sync never encounters merge conflicts; duplicate network retries are completely harmless.

---

### ADR-005: Two-Dimensional Side-View Geometry for Squats & Push-ups
* **Status**: Accepted
* **Context**: 3D world pose landmarks from monocular smartphone cameras exhibit depth ambiguity and jitter along the Z-axis, particularly on budget camera sensors.
* **Decision**: Use calibrated 2D projected joint angles (Hip-Knee-Ankle for squats; Shoulder-Elbow-Wrist for push-ups) optimized for side-view phone placement.
* **Consequences**: Increases rep counting stability while avoiding noisy depth-estimation failures on low-end smartphones.

---

### ADR-006: Moderated Structured Committee Chat (No Private 1:1 DMs)
* **Status**: Accepted
* **Context**: Collegiate communications require channels for announcements, squad coordination, and asking sports officers questions, but unmonitored private 1:1 direct messages present severe harassment, ragging, and safety liabilities.
* **Decision**: Implement text-only structured channels: (1) Squad Chat (members only), (2) Campus Announcements (officers write, students read & react), and (3) "Ask the Committee" (1-to-committee private thread). Disallow private 1:1 DMs entirely. Enforce link blocking for unapproved domains, crisis/abuse automated flagging (without silent auto-penalties), and a human officer moderation queue.
* **Consequences**: Ensures a safe, transparent campus communication space with audit logging, explicit consent, retention purge, and complete data export/delete coverage.

