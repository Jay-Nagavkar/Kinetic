# KhelSetu: Human Actions & Field Approvals Required

This document lists all tasks, approvals, and data collections that require human participation, physical hardware, or legal/institutional authorization and **cannot be simulated or hardcoded**.

---

## 1. Ethical & Legal Approvals
- [ ] **Institutional Ethics Board (IRB / IEC) Approval**: Obtain formal clearance for conducting an 8-week physical activity study across 2 pilot hostels.
- [ ] **DPDP Legal Review**: Finalize institutional Data Processing Agreement (DPA) and confirm consent-manager readiness before multi-college rollout (estimated mandatory date: ~May 2027).
- [ ] **Physical Education Council MoU**: Sign pilot cooperation agreement with college sports directors.

---

## 2. Volunteer Recording & Benchmarking
- [ ] **Volunteer Trace Collection (20–30 Participants)**:
  - Record ground-truth rep sessions across 4 smartphone tiers (Low, Mid, Flagship Android + iOS).
  - Collect varying lighting environments (Bright daylight, 100 lux tube light, evening warm light).
  - Annotate inflection timestamps using `scripts/eval_reps.mjs`.
- [ ] **Device FPS & Latency Calibration**:
  - Run `?debug=1` on a physical MediaTek Helio G35 / Snapdragon 680 device to record real-world WebAssembly inference FPS.

---

## 3. Linguistic & Translation Review
- [ ] **Native Speaker Hindi Review**: Validate all Hindi UI strings in `frontend/i18n.js` with native-speaking students to ensure colloquial naturalness and clarity.
- [ ] **Marathi Translation Addition**: Engage Marathi-speaking volunteers to verify strings for western India state pilots.

---

## 4. Production Infrastructure Credentials
- [ ] **Institutional SMTP / SMS Gateway**: Provision official college email OTP sender credentials for production registration.
- [ ] **Production SSL / Domain**: Configure valid HTTPS domain (required for WebRTC camera permissions on mobile devices outside localhost).
