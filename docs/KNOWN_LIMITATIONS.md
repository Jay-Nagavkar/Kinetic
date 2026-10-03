# KhelSetu: Known Limitations & Technical Constraints

---

### 1. Camera Placement & Framing Constraints
- **Side-View Requirement**: Squats and push-up rep counting relies on 2D joint angles (Hip-Knee-Ankle and Shoulder-Elbow-Wrist). Accurate tracking requires the phone to be propped against a wall/water bottle approximately 1.5m – 2.5m away with the user in side profile.
- **Lighting Sensitivity**: In extreme low-light environments ($<30$ lux), MediaPipe landmark detection confidence drops significantly, triggering the integrity gate's `body_not_visible` or `low_confidence` flag.

### 2. Clothing & Occlusion
- **Loose / Traditional Attire**: Excessively baggy kurtas, wide-leg pajamas, or blankets can obscure knee and hip joints, causing joint angle smoothing to underestimate full range of motion.
- **Partial Obstruction**: If furniture (e.g. hostel bed frame, chair) blocks the feet or wrists, reps cannot be verified.

### 3. Hardware & Browser Differences
- **Budget Android (<3GB RAM)**: May experience lower inference framerates (10–14 FPS) on older CPU-only WebAssembly delegates. KhelSetu includes dynamic downscaling to preserve responsiveness.
- **iOS Safari WebRTC Restrictions**: iOS requires an explicit user gesture to initialize camera video streams and does not support background camera execution in PWAs.

### 4. Normative Data Scope
- **Provisional Starting Bands**: Starting baseline bands (*Starter, Building, Steady, Strong*) are scaled against placeholder reference values because no public, open Indian university fitness normative dataset exists. The pilot baseline survey will establish these norms empirically.
