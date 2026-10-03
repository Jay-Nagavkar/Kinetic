# Changelog

All notable changes to the KhelSetu project will be documented in this file.

## [0.3.0-P2-P3] - 2026-10-02

### Added
- **Seated / Adaptive FitCheck Exercises (Phase 2)**: Added Seated Arm Raises (`arm_raise`) in `frontend/engine.js` with upper-body landmark geometry (`hip-shoulder-elbow`), dedicated adaptive test config, and baseline integration for injured or wheelchair-seated students.
- **Web Speech Synthesis Audio Coach (Phase 10)**: Integrated browser SpeechSynthesis API in `frontend/app.js` with bilingual voice coaching (English & Hindi) for countdowns, form alerts, milestone reps, and test completion verdicts.
- **Campus Facility Slot Finder & Reservation (Phase 3)**: Added `/api/facilities/slots` and `/api/facilities/reserve` with live occupancy metrics for badminton courts, strength gyms, TT arenas, and running tracks, with a dedicated student reservation UI in `frontend/app.js`.
- **DPDP Act 2023 Statutory Compliance Runbook (Phase 9)**: Authored `docs/DPDP_RUNBOOK.md` detailing notice/consent, age gating (§9), DSAR exports (§11), right-to-be-forgotten erasure (§12), and edge processing privacy safeguards.
- **Web Crypto Event Signing (Phase 3 Hardening)**: Client generates on-device ECDSA P-256 keypairs via Web Crypto API, registers public key on signup, and signs all append-only events (`sig`), with cryptographic verification and audit logging in `/api/sync`.
- **Expanded Test Suites**: 16 passing engine tests (`tests/engine.test.mjs`) and 14 passing backend tests (`tests/test_backend.py`).

## [0.2.0-P1] - 2026-10-02

### Added
- **Officer Session Check-Ins**: Integrated `/api/session/checkin` on the Log activity screen allowing students to enter 4-character codes from sports officers to claim verified active minutes offline or online.
- **Squad Safety & Member Privacy**: Added "Leave Squad" and "Report Squad" moderation endpoints (`/api/squads/{id}/leave`, `/api/squads/{id}/report`) with confirmation workflows, and added a member toggle to hide completion percentage from squad peers.
- **Retest Delta Loop**: Automated baseline index comparison ($Δ = \text{new} - \text{old}$) with progress feedback and persistent recording via `/api/retest/record`.
- **Storage Persistence**: Integrated `navigator.storage.persist()` to safeguard offline IndexedDB and Cache storage against mobile browser cache eviction.
- **Service Worker Versioning**: Updated Service Worker cache to `khelsetu-v2-p1` with update listener prompting user to reload on new bundle deployment.
- **Docker & Compose Infrastructure**: Created production-ready `Dockerfile`, `docker-compose.yml`, and `.dockerignore`.
- **Expanded Test Suites**: 15 passing engine tests (`tests/engine.test.mjs`) and 13 passing backend tests (`tests/test_backend.py`).

## [0.2.0-P0] - 2026-10-02

### Added
- Created `docs/HONEST_CLAIMS.md` and `docs/CLAIMS_VS_EVIDENCE.md` defining supported claims and explicit non-claims.
- Created `docs/DECISIONS.md` documenting ADR-001 through ADR-005.
- Created `docs/HUMAN_ACTIONS.md` and `docs/KNOWN_LIMITATIONS.md`.
- Implemented One-Euro adaptive filter in `frontend/engine.js` alongside EMA smoothing for low-lag, jitter-free joint tracking.
- Added 3D world landmark angle support in `frontend/engine.js` with configurable landmark coordinate space.
- Built replay harness and trace evaluator CLI in `scripts/eval_reps.mjs` with `docs/TRACE_SCHEMA.md`.
- Implemented pre-test framing check in `frontend/app.js` with full-body detection, brightness/luminance validation, and orientation guidance.
- Added live FPS and inference latency monitor under `?debug=1`.
- Tagged simulated workout sessions with `source = "sim"` in event logs.
- Hardened $k$-anonymity in `backend/main.py` and `frontend/admin.html` with differencing protection (total leak fix).

### Fixed
- Corrected misleading claims in `README.md` and codebase comments (removed claims of stateless JWTs and database-level RLS).
- Fixed the total leak in the admin observatory where campus-wide totals previously revealed suppressed group sizes.
- Added provisional baseline band labeling across UI and documentation.

## [0.1.0-MVP] - 2026-10-02
- Initial MVP prototype with on-device MediaPipe Pose, squats, push-ups, balance tests, squads, offline-first IndexedDB sync, and FastAPI server.
