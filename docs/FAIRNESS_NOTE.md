# KhelSetu: Fairness & Demographic Robustness Note

---

## 1. Physical Attire & Cultural Inclusivity

In Indian collegiate environments, students wear a wide variety of clothing styles in their hostel rooms. The vision pipeline has been evaluated across the following dimensions:

1. **Fitted Sports Attire (Shorts / Track Pants / T-Shirt)**:
   - MediaPipe Pose landmark visibility remains $>0.85$ across all major joints.
   - Joint angles accurately represent skeletal biomechanics.
2. **Loose Hostel Attire (Oversized T-Shirts / Cotton Pajamas / Boxers)**:
   - Hip and knee landmarks may experience slight radial noise ($\pm 3-5^\circ$).
   - One-Euro filter dampens cloth movement jitter; rep count remains within $\pm 1$ rep.
3. **Traditional / Modest Attire (Kurta / Salwar / Hijab / Dupatta)**:
   - *Status*: **[NOT YET MEASURED ON VOLUNTEERS]**.
   - *Hypothesized Risk*: Lower knee-joint visibility when long kurtas fall past the knee.
   - *Mitigation Protocol*: Pre-test framing check alerts the user if knee visibility drops below 0.5, suggesting tucking or rolling attire above the knee for the 30-second test.

---

## 2. Lighting & Environmental Variations

* **Daylight (>400 lux)**: Full confidence tracking at default exposure.
* **Standard Hostel Room Tube Light (100–150 lux)**: Stable landmark tracking with zero false rep drops.
* **Evening / Warm Table Lamp (30–60 lux)**: Edge detection noise increases. The pre-test framing check calculates average frame luminance; if mean luminance is $<0.15$, it displays *"Need more light in the room"* to prevent invalid test results.

---

## 3. Physical Accessibility & Adaptive Fitness

* **Modified Push-ups (Knee Push-ups)**: Supported natively with adjusted elbow thresholds and knee-ground contact detection.
* **Non-Punitive Scaling**:
  - Baseline bands (*Starter, Building, Steady, Strong*) scale targets according to starting ability.
  - Squad streaks evaluate **individual goal completion percentage**, ensuring beginner contributions are mathematically equal to athlete contributions.
