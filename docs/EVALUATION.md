# KhelSetu: Prototype Evaluation & Performance Metrics

---

## 1. Prototype Technical Metrics

| Evaluation Metric | Target Benchmark | Current Status | Verification Source |
| :--- | :--- | :--- | :--- |
| **Rep Counting MAE** | $\text{MAE} \le 1.0$ rep | **0.00 reps** (Synthetic baseline) / *[Pending Volunteers]* | `scripts/eval_reps.mjs` |
| **Off-by-One Accuracy** | $\text{Acc}_{\pm 1} \ge 90\%$ | **100.0%** (Synthetic baseline) / *[Pending Volunteers]* | `scripts/eval_reps.mjs` |
| **Balance Hold Error** | $\Delta t \le 1.0$ s | **0.08 s** (Synthetic baseline) | `tests/engine.test.mjs` |
| **Inference Framerate (Mid-Tier)** | $\ge 20$ FPS | **[NOT YET MEASURED ON PHYSICAL HARDWARE]** | Requires field device (`?debug=1`) |
| **Offline Sync Reliability** | $100\%$ idempotent ingest | **100% Verified** | `tests/test_backend.py` |
| **FitCheck Completion Time** | $\le 3.5$ minutes | **~3.2 minutes** | Simulated user flow |

---

## 2. System Usability Scale (SUS) Evaluation Template

For user interviews during the 2-week squad prototype:

```markdown
1. I think that I would like to use KhelSetu frequently for my workouts. (1-5)
2. I found the system unnecessarily complex. (1-5)
3. I thought the system was easy to use. (1-5)
4. I think that I would need the support of a technical person to use this system. (1-5)
5. I found the various functions in this system were well integrated. (1-5)
6. I thought there was too much inconsistency in this system. (1-5)
7. I would imagine that most students would learn to use this system very quickly. (1-5)
8. I found the system very cumbersome to use. (1-5)
9. I felt very confident using the system in my hostel room. (1-5)
10. I needed to learn a lot of things before I could get going with this system. (1-5)
```
*Target SUS Score*: $\ge 75$ (Above average usability benchmark).
