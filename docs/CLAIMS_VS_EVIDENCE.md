# KhelSetu: Claims vs. Evidence Matrix

Every numerical claim, behavioral assertion, or architectural property used in the project, codebase, and presentation pitch is categorized below according to its evidentiary status:
- **[SOURCED]**: Supported by peer-reviewed literature, official government gazettes, or authoritative guidelines.
- **[MEASURED]**: Quantitatively verified by automated tests, scripts, or benchmarks within this repository.
- **[ASSUMPTION]**: Design hypothesis to be formally calibrated during field pilots.
- **[NOT YET MEASURED]**: Metric requiring human volunteers or multi-device hardware testing.

---

| # | Claim / Statement | Status | Evidence / Source | Implementation Note |
| :- | :--- | :--- | :--- | :--- |
| **1** | 49.4% of Indian adults are physically inactive in 2022 (up from 22.3% in 2000). | **[SOURCED]** | *Lancet Global Health*, Strain et al. (June 2024), DOI: 10.1016/S2214-109X(24)00150-5. | Cited in Pitch & Docs. |
| **2** | Indian collegiate inactivity rates vary widely across studies (11% to >50%). | **[SOURCED]** | BHU study (14.5% via IPAQ-L; PubMed 37725547); Zenodo 886613 (11.37%); Zenodo 15780398. | Explains why KhelSetu measures its own pilot baseline. |
| **3** | Gamification yields modest, short-term physical activity increases (~1,420 steps/day). | **[SOURCED]** | JMIR 2022 Meta-Analysis (16 RCTs, 2,407 subjects; Hedges g=0.42; follow-up g=0.09). | Justifies measuring real active minutes rather than raw logins. |
| **4** | Camera video never leaves the client device. | **[MEASURED]** | Automated privacy audit test; WebRTC stream piped to in-memory Web Worker canvas only. | `pose.js` processes frames in memory; no upload endpoints exist for video. |
| **5** | Offline sync is idempotent and survives network dropouts. | **[MEASURED]** | `tests/test_backend.py` (`test_sync_is_idempotent_and_validates`). | Client UUIDs as primary keys with `INSERT OR IGNORE`. |
| **6** | Small groups ($<10$ students) are concealed from campus administrators. | **[MEASURED]** | `tests/test_backend.py` (`test_admin_requires_key_and_k_anonymity`). | $k$-anonymity suppression with complementary suppression to prevent subtraction. |
| **7** | Computer vision rep counting MAE and off-by-one accuracy. | **[NOT YET MEASURED]** | Awaiting 20–30 human volunteer recordings across 4 phone tiers. | Benchmark harness in `scripts/eval_reps.mjs` generates live report. |
| **8** | Baseline bands (*Starter, Building, Steady, Strong*) scale weekly active minute goals. | **[ASSUMPTION]** | Design hypothesis scaling toward WHO 150 min/week threshold. | To be calibrated during 8-week hostel pilot. |
| **9** | 60-minute daily credited activity limit. | **[ASSUMPTION]** | Gameplay fairness and anti-burnout design safeguard. | Configurable per institution; not a medical threshold. |
| **10** | DPDP Act 2023 & Rules 2025 require verifiable parental consent for minors ($<18$). | **[SOURCED]** | Digital Personal Data Protection Rules notified Nov 2025; PIB notification. | Justifies 18+ gate for hackathon MVP pilot. |
