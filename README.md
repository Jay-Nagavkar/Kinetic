# KhelSetu (SIH26196)

> **Inclusive, privacy-first collegiate fitness and physical literacy platform**: Private on-device FitCheck, fairness-designed leaderboards, moderated committee chat, gym-photo feed, meal calorie tracking, and KhelBuddy AI assistant.

---

## 1. Core Architecture & Key Features

### 🏋️ Feature A: UI/UX Overhaul & Habit System
- **Design Tokens System** (`tokens.css`): Light, Dark, and High-Contrast modes meeting strict WCAG AA contrast standards.
- **Micro-Animations & Celebrations**: Confetti celebration engine for weekly goal completions, skeleton loaders, and tactile haptic feedback.
- **Streak & Rest Protection**: Rest days are celebrated and protected (`Rest Day - Protected`), eliminating guilt and promoting sustainable habits.
- **Milestone Badges & Avatar Picker**: Consistency Star, Comeback Champ, Retest Explorer, and Squad Anchor badges.

### 🏆 Feature B: Fairness-Designed Leaderboards
- **No Raw-Performance Shaming**: Students are never ranked on raw reps or weight.
- **Squad League**: Ranked by mean percentage of members' personal baseline goals achieved ($0\text{–}100\%$).
- **Department Participation Rate League**: Percentage of department students meeting 150 active minutes/week, with strict $k$-anonymity suppression ($k \ge 10$).
- **Consistency & Most Improved Boards**: Optional pseudonym/alias support with full 1-click leaderboard opt-out.
- **Monday IST 00:00 Cycle**: Automated clean weekly resets.

### 💬 Feature C: Moderated Committee Chat
- **Scaffolded Channels**: Campus Announcements (officer broadcast), Squad Chat (team motivation), and Ask the Committee (private support).
- **Proactive Safety Guardrails**: External URL/spam blocking, crisis detection with national helpline referrals, and automated abuse filtering.
- **Moderator Queue & Tenant Isolation**: Multi-tenant institutional isolation with officer review dashboard and 90-day retention purges.

### 📷 Feature D: Gym-Photo Feed & Share Card
- **EXIF-Stripping Upload Pipeline**: Automated server-side scrubbing of GPS coordinates, camera serial numbers, and device metadata.
- **Image Security**: Magic bytes verification (JPEG/PNG/WebP) and Pillow decompression bomb guards (`MAX_IMAGE_PIXELS = 10_000_000`).
- **Visibility Scoping**: User controls photo audience (Squad Only, Hostel/Department, or Campus-Wide).
- **Web Share API Milestone Card**: On-device Canvas card generator with zero calorie/BMI shaming metrics.

### 🥗 Feature E: Meal-Photo Calorie Tracking
- **Vision Food Identification**: AI-driven detection of collegiate mess and canteen staples.
- **Standard Reference Database** (`docs/NUTRITION_DATA.md`): Food composition data from ICMR-NIN Indian Food Composition Tables (IFCT 2017) & USDA FoodData Central.
- **Mandatory User Confirmation Screen**: Interactive portion weight sliders to verify or edit dishes before logging.
- **Evaluation Harness** (`scripts/eval_meals.py`): Benchmark suite testing ground-truth plates.

### 🤖 Feature F: KhelBuddy AI Assistant
- **Grounded Fitness Coaching**: Non-medical habit guidance grounded in WHO physical literacy recommendations and the student's own weekly progress.
- **Strict Guardrails** (`prompts/khelbuddy.v1.md`): Prompt-injection defense, no medical diagnosis, and crisis support protocols.

### 🔒 Feature G: Privacy & DPDP Compliance
- **FitCheck Camera Privacy**: Camera frames and pose-estimation video **never leave the user's device**. Only derived rep counts leave the device.
- **Itemized Consents & Erasure**: Voluntary upload consents for gym photos and meal tracking, data export (`/api/me/export`), and complete account erasure (`/api/me/delete`).

---

## 2. Quickstart & Local Setup

### Requirements
- Python 3.10+
- Node.js 18+

### Start the Platform
```bash
# Install backend dependencies
pip install -r backend/requirements.txt

# Start backend server (serves frontend PWA on port 8000)
npm start
```
Open **`http://localhost:8000`** in your browser.

### Campus Admin Observatory
Open **`http://localhost:8000/admin.html`**:
- Admin Key: `demo-admin`
- Institution: `DEMO`
- Click **"Seed Synthetic Demo Cohort"** to load realistic synthetic campus data demonstrating $k$-anonymity.

---

## 3. Running All Test Suites & Benchmarks

```bash
# Run the complete test suite (57+ passing unit & integration tests)
npm test

# Run individual feature tests:
npm run test:engine        # Pose state machine, One-Euro filter, 3D angle tests
npm run test:backend       # Core auth, activity sync, check-in, k-anonymity
npm run test:leaderboards   # Fairness-designed leaderboards & alias privacy
npm run test:chat          # Committee chat, abuse/crisis guardrails, mod queue
npm run test:feed          # EXIF stripping, post visibility, feed moderation
npm run test:meals         # Meal analysis, IFCT lookup, retention purge
npm run test:assistant     # KhelBuddy grounding, prompt injection defense

# Run evaluations:
npm run eval:meals         # Meal nutrition estimation accuracy harness
npm run eval:reps          # Pose estimation rep counting accuracy
npm run sim:leaderboards   # 200-user Monte Carlo leaderboard fairness simulation
```

---

## 4. Documentation Index

- [docs/COMMUNITY_GUIDELINES.md](file:///d:/Projects/khelsetu/docs/COMMUNITY_GUIDELINES.md): Campus community and photo conduct standards.
- [docs/NUTRITION_DATA.md](file:///d:/Projects/khelsetu/docs/NUTRITION_DATA.md): IFCT 2017 & USDA food composition database reference.
- [docs/MEAL_ACCURACY_REPORT.md](file:///d:/Projects/khelsetu/docs/MEAL_ACCURACY_REPORT.md): Evaluation protocol for meal photo nutrition estimation.
- [docs/DECISIONS.md](file:///d:/Projects/khelsetu/docs/DECISIONS.md): Architectural Decision Records (ADR-001 through ADR-007).
- [docs/HONEST_CLAIMS.md](file:///d:/Projects/khelsetu/docs/HONEST_CLAIMS.md): Verified product capabilities and clear limitations.
- [docs/PRIVACY_NOTE.md](file:///d:/Projects/khelsetu/docs/PRIVACY_NOTE.md): DPDP Act compliance and itemized consent definitions.
- [docs/THREAT_MODEL.md](file:///d:/Projects/khelsetu/docs/THREAT_MODEL.md): Security analysis, EXIF scrubbing, and jailbreak defenses.
- [docs/DPDP_RUNBOOK.md](file:///d:/Projects/khelsetu/docs/DPDP_RUNBOOK.md): Data subject access and erasure handling procedures.
- [docs/JUDGE_QA.md](file:///d:/Projects/khelsetu/docs/JUDGE_QA.md): Comprehensive judge Q&A guide for SIH 2026.
