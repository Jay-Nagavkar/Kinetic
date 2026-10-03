# KhelSetu: Privacy Architecture & DPDP Alignment

---

## 1. Data Processing Inventory

```
 [ Camera Stream ] ──> [ In-Memory WebAssembly ] ──> [ Discarded Immediately ]
                              │
                              ▼ (Only Scalar Summaries)
                 [ IndexedDB Append-Only Event Log ]
                              │
                              ▼ (Idempotent Sync when Online)
                  [ KhelSetu Server (FastAPI) ]
```

* **Personal Identifiers**: Display Name, College Code, Group/Hostel, Year of Study (stored for squad matching).
* **Assessment Data**: Exercise Type, Rep Count / Hold Duration, Integrity Verdict, Confidence Score, Timestamp.
* **Consent Records**: Consent Version, Purposes Granted, Age 18+ Confirmation, Timestamp.

---

## 2. DPDP Principles Alignment (India DPDP Rules 2025/2026)

1. **Purpose Limitation**: Personal data is collected solely for fitness tracking, squad accountability, and anonymized physical education planning.
2. **Data Minimization**:
   - No raw pixels or audio captured.
   - PAR-Q health questionnaire answers are never transmitted; only the binary readiness outcome (*cleared* vs *gentle*) is saved.
3. **Storage Limitation & Right to Erasure**:
   - Users can download their complete activity ledger at any time via `/api/me/export`.
   - Users can permanently and irreversibly erase all personal data from the server and local device via `/api/me/delete`.
4. **Child Data Protection (Section 9)**:
   - To eliminate DPDP minor data processing risks during prototype validation, KhelSetu strictly restricts pilot eligibility to **adult students (aged 18 and older)**.
