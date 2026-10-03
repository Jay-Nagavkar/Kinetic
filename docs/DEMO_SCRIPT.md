# KhelSetu: 4-Minute Hackathon Demo Script & Runbook

---

## Pre-Demo Checklist (T-Minus 5 Minutes)
- [ ] Ensure local backend server is running (`npm start` or `python -m uvicorn backend.main:app`).
- [ ] Open `http://localhost:8000/?demo=1` in a Chrome browser window sized to mobile viewport ($390\times800$).
- [ ] Open `http://localhost:8000/admin.html` in a second tab.
- [ ] Verify audio is enabled (for Web Audio synthesized countdown and rep chimes).

---

## 4-Minute Presentation Timeline

### Minute 0:00 – 0:45: The Problem & Offline Onboarding
1. **Show Offline Resilience**:
   - Turn on the in-app **"Simulate airplane mode"** toggle in Settings/Privacy. The header chip immediately reflects `Offline (0 pending)`.
2. **Onboarding in Hindi**:
   - Switch language to **हिन्दी**.
   - Enter name *"Shruti"*, college *"DEMO"*, group *"Hostel B (Girls)"*.
   - Check the **18+ Age Confirmation** and accept the data minimization consent notice.
   - Complete the 7-question health readiness check (PAR-Q) with all "No" answers.
   - Transition to Home: show the 7-day visual **Bridge** and provisional starting bands.

### Minute 0:45 – 2:00: Private On-Device FitCheck in Silhouette Mode
1. **Launch FitCheck Squats**:
   - Click **"FitCheck शुरू करें"** $\to$ Select **Squats**.
   - Enable **"केवल कंकाल (Silhouette Mode)"**.
   - Click **"शुरू करें (Start)"** (or use *"सिम्युलेटेड डेमो"* if live camera is not available on stage).
2. **Audio & Form Feedback**:
   - Web Audio countdown chimes: $3 \dots 2 \dots 1 \dots \text{Go!}$
   - Perform/simulate 3 full squats: ascending dual-tone chime plays on each valid rep.
   - Demonstrate integrity rejection: perform a shallow bounce or simulate leaving frame $\to$ low-frequency warning buzz plays, and prompt displays *"धीमे करें: केवल पूरे रेप्स गिने जाते हैं"*.
3. **Save Baseline**:
   - Finish 30-second session.
   - Result screen shows verified reps + confidence score. Click **"नतीजा सहेजें"**.
   - Baseline automatically recalculates starting band (e.g. *Building*) and generates scaled weekly goal (e.g. *90 min/wk*).

### Minute 2:00 – 2:45: Fair-Play Squad Streaks
1. **Navigate to Squad Tab**:
   - Show squad dashboard. Explain fair-play scoring:
     > *"Notice that our squad score is not based on raw reps or total minutes. It is the mean percentage of each member's personal goal achieved. An active beginner doing 60 minutes contributes just as much as an athlete doing 150 minutes."*
   - Show member list: raw reps and BMI are never exposed; only individual goal completion percentages (e.g. $75\%$) are visible.

### Minute 2:45 – 3:30: Reconnect & Event-Sourced Sync
1. **Turn Off Airplane Mode**:
   - Return to Privacy/Settings $\to$ Uncheck airplane mode.
   - The network chip switches to `Online` and automatically fires an idempotent background sync.
   - Open browser developer tools / console to show the clean JSON sync payload containing scalar event summaries (no video frames).

### Minute 3:30 – 4:00: Campus Fitness Observatory for Sports Officers
1. **Switch to Admin Tab (`admin.html`)**:
   - Click **"Load Live Analytics"** (or **"Seed Synthetic Demo Cohort"**).
   - Point out the **$k$-Anonymity Privacy Guarantee ($k \ge 10$)**:
     > *"Notice that 'Mech Year 3' has only 4 students and is completely suppressed to prevent re-identification. Campus totals only reflect visible cohorts to prevent subtraction attacks."*
   - Click **"Export CSV"** and **"Export JSON"** to demonstrate one-click compliance reporting for college sports directors and Fit India returns.
