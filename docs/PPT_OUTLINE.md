# KhelSetu: 16-Slide SIH Presentation Deck Script

---

### Slide 1: Title & Vision
* **Header**: **KhelSetu (खेलसेतु)** — The Offline-First Collegiate Fitness Loop
* **Subtitle**: Bridging Student Inactivity through Private Edge Computer Vision, Fair Squads, and Campus Insights.
* **Metadata**: Problem Statement: SIH26196 | Technology Bucket: Fitness & Sports | Team: 6 Students.
* **Speaker Talking Point**: *"Nearly half of Indian adults are insufficiently active. While colleges have sports departments, they have zero visibility into student activity outside campus teams. KhelSetu is the privacy-first bridge."*

---

### Slide 2: The Problem Deconstruction
* **Data Points**:
  - **49.4% of Indian adults** are physically inactive (Lancet Global Health, 2024; up from 22.3% in 2000).
  - High drop-off during college years due to academic pressure, fatigue, and lack of accountability.
  - Hostellers face acute barriers: cramped shared rooms, gym intimidation, and embarrassment about exercising on camera.

---

### Slide 3: Current National Situation & Gaps
* **National Programs**:
  - *Fit India Movement* (2019): Great national awareness, but relies on manual self-reporting.
  - *Khelo India Assessment*: Standardized exclusively for school children (ages 5–18); no digital adult collegiate infrastructure exists.
* **Commercial Apps (Cult.fit, Strava, HealthifyMe)**:
  - Paywalled subscriptions, high cognitive load (manual calorie logging), and public leaderboards that alienate beginners.

---

### Slide 4: The Innovation Gap
* **Why Existing Approaches Fail**:
  - **Privacy Fear**: Students will not use cloud-based camera apps in shared hostel rooms.
  - **Unfair Gamification**: Raw-rep leaderboards demoralize beginners.
  - **Connectivity Friction**: College Wi-Fi dropouts break web apps.
  - **Blind Sports Departments**: Physical Education officers have no aggregate data to allocate sports facilities effectively.

---

### Slide 5: The KhelSetu Solution (The 4-Part Bridge)
* **Visual Diagram**:
  1. **Baseline**: 5-minute private FitCheck (Squats, Push-ups, Balance).
  2. **Action**: Scaled weekly active-minute goals scaling toward WHO 150m.
  3. **Accountability**: 4–8 person squads with fair-play mean scoring.
  4. **Institution**: $k$-Anonymous campus observatory for sports directors.

---

### Slide 6: User Journey (A Day in the Life of a Hosteler)
* **Step 1**: Onboards in Hindi/English; completes local 7-question health readiness check (PAR-Q).
* **Step 2**: Props phone against a water bottle in dorm room; turns on Silhouette Mode.
* **Step 3**: Does 30s squats; on-device MediaPipe counts reps with audio chimes. Video is discarded in volatile RAM.
* **Step 4**: Logs 20 mins evening badminton; squad streak advances by 50%.
* **Step 5**: Offline event log automatically syncs when student connects to library Wi-Fi.

---

### Slide 7: Core Features Matrix
* **Must-Have (Built & Verified)**: On-device MediaPipe Pose WASM, Silhouette Mode, Hysteresis Rep Counter, Fair-play Squads, Offline IndexedDB queue, $k$-Anonymous Admin Observatory.
* **Safety & Integrity**: Form rejection for hip sagging/bouncing, 60 min/day credit cap, 18+ DPDP age gate.

---

### Slide 8: Honest Novelty & Differentiators
* **What is NOT Novel**: Pose-based rep counting is not new.
* **What IS Novel (The Combination)**:
  1. Assessor-free, offline integrity-gated self-assessment.
  2. Silhouette Privacy Mode (skeleton vector on dark canvas with 0 pixel upload).
  3. Mean-based squad scoring protecting weaker members.
  4. $k$-Anonymity campus analytics with differencing attack protection.

---

### Slide 9: System Architecture
* **Client**: PWA (HTML5/Vanilla JS) $\to$ MediaPipe WebAssembly $\to$ IndexedDB Append-Only Queue.
* **Network**: HTTPS Idempotent Batch Sync with client UUIDs.
* **Server**: FastAPI REST API $\to$ SQLite (MVP) / PostgreSQL with tenant isolation.
* **Dashboard**: $k$-Anonymous Campus Observatory ($k \ge 10$).

---

### Slide 10: Edge AI & Computer Vision Pipeline
* **Model**: Google MediaPipe PoseLandmarker Lite (float16 `.task`, 5.77 MB vendored locally).
* **Smoothing**: One-Euro adaptive filter (Casiez et al. 2012) for zero-lag inflection tracking.
* **Integrity Gate**: Multi-person rejection, visibility thresholds ($>60\%$), and tempo variation checks.

---

### Slide 11: Technology Stack
* **Frontend**: HTML5, Vanilla ES Modules, Vanilla CSS, Web Audio API, Service Worker.
* **Vision**: MediaPipe Vision Bundle (WASM).
* **Backend**: FastAPI (Python 3.11).
* **Database**: SQLite with tenant-scoped SQL queries.

---

### Slide 12: Privacy, Safety & DPDP Alignment
* **Zero Video Ingestion**: No raw pixels ever leave device RAM.
* **Data Minimization**: Health questionnaire answers never leave the phone.
* **User Control**: 1-click JSON data export and 1-click irreversible account erasure.
* **Age Gating**: 18+ restriction eliminates minor data parental consent risks for pilot.

---

### Slide 13: Claims vs. Evidence Slide
* **Sourced Evidence**: Lancet 2024 physical inactivity trends; JMIR 2022 RCT meta-analysis on gamification limits.
* **Measured Evidence**: 100% idempotent offline sync; $k$-anonymity differencing protection tested via automated test suites.
* **Honest Disclosures**: Baseline bands are provisional placeholders; volunteer benchmark MAE currently measured on synthetic kinematics and awaiting human cohort data.

---

### Slide 14: Feasibility & Financial Viability
* **Hosting Economics**:
  - Edge AI shifts all CV inference to user phones (₹0 server GPU cost).
  - Single college pilot (500 students): ~₹1,200–₹1,800/month on AWS Mumbai / Railway.
  - Multi-campus cluster (10,000 students): ~₹8,500/month.

---

### Slide 15: Implementation Roadmap
* **Phase 1 (Hackathon MVP - Complete)**: Core engine, silhouette mode, offline sync, observatory.
* **Phase 2 (1–3 Months)**: 2-hostel field pilot, 30-volunteer camera accuracy calibration, native-speaker language review.
* **Phase 3 (6–12 Months)**: Multi-college deployment, sports officer challenge modules, DPDP readiness.

---

### Slide 16: Live Demonstration & Impact
* **Live Demo**: 4-minute workflow showing offline onboarding $\to$ silhouette FitCheck $\to$ squad streak $\to$ admin observatory with $k$-anonymity suppression.
* **Impact North Star**: Moving collegiate inactive students from 0 to 150 active minutes/week through fair, non-punitive squad accountability.
