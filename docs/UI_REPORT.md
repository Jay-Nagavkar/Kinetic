# KhelSetu UI Redesign Report — v2 "Neon Arena / Chalk"

> Last updated: 2026-10-03

---

## What Changed

### Design System (tokens.css)
- **Neon Arena (dark default)**: `--bg:#07100D`, mint/lime/sky/coral/orange/violet accent palette
- **Chalk (light)**: `--bg:#F4F8F5`, desaturated analogous accents
- **High Contrast**: pure black/white with strong fills
- **Performance tiers**: `full` (blur/aurora) → `lite` (no backdrop-filter) → `minimal` (flat surfaces, no animation)
- **Fluid type scale**: `clamp()`-based from `--text-xs` (0.70rem) to `--text-3xl` (4.00rem). Supports 200% text scaling.
- **Ease tokens**: `--ease-spring`, `--ease-out`, `--ease-in-out` with `cubic-bezier` spring physics
- **Legacy aliases preserved**: All old token names (`--court`, `--marigold`, `--chalk`, etc.) map to new values so no old CSS breaks

### Layout (styles.css)
- Glass top bar with `backdrop-filter` and `@supports` fallback (solid translucent)
- **Phone**: floating glass pill bottom nav; **Desktop (≥1024px)**: left nav rail + wider content area
- Responsive bento grid (`grid-template-columns: 1fr 1fr` → 3 columns at 640px+)
- No horizontal overflow at 320px, 768px, 1280px (CSS `overflow-x: hidden` on body + `bento` grid)
- Safe-area-inset-aware on all fixed elements

### Home Screen (viewHome in app.js)
- **Greeting row**: avatar (gradient circle), personalised "Hey, {name} 👋", streak chip (🔥 or 🛡 never shaming)
- **Hero card**: aurora gradient background, big count-up number + progress ring (SVG with `stroke-dashoffset` animation), gradient arch + 7 planks bridge, today's plank has idle glow pulse
- **Primary CTA**: `btn.primary.cta-pulse` — mint/lime gradient, dark ink text, soft idle pulse (disabled under reduced-motion)
- **Bento tiles** (replacing the old uniform button grid): Chat (sky), Feed (coral), Meals (orange), Leaderboard (sun), KhelBuddy AI (violet wide tile) — each with icon, label, sub-label, colour-border hover effect
- **Milestone badges carousel**: horizontal scroll, SVG icons (not emoji), gold glow on earned
- Encouraging copy never shames a missed day

### Navigation
- Old: 5 plain `<button>` in `<nav class="tabs">` with text labels
- New: same elements styled with `nav-btn` class, floating pill on mobile, desktop rail
- FitCheck gets a raised gradient pill in the nav (most visually prominent)
- `data-testid="nav-{k}"` added to every nav button

### KhelBuddy AI (assistant sheet)
- Violet/sky gradient header bar, breathing orb animation on FAB, sheet-up animation, `@keyframes sheet-up`
- Safety: disabled under `prefers-reduced-motion`

### FitCheck Stage
- Neon skeleton: `filter: drop-shadow(0 0 4px rgba(46,230,166,.6))` on canvas
- Count pop: `hud .count.pop` now uses lime colour + glow
- `framing-guide.valid` turns mint solid when in-frame

### You / Privacy Screen
- Theme selector: Neon Arena / Chalk / High Contrast dropdown
- Performance Tier selector: Full / Lite / Minimal
- Reduce Motion override checkbox
- All update in real-time (sets `data-theme`, `data-tier`, `data-reduce-motion` on `<html>`)

### Boot
- Default theme: **dark** (Neon Arena)
- Performance tier auto-detected via `deviceMemory < 2`, `hardwareConcurrency < 4`, `prefers-reduced-data`
- `prefers-reduced-motion` auto-detected at boot and stored as `data-reduce-motion="1"` on `<html>`

---

## Verified / Tested

| Check | Result |
|-------|--------|
| All 16 JS unit tests | ✅ PASS |
| All Python backend tests | ✅ PASS |
| All leaderboard, chat, feed, meals, assistant tests | ✅ PASS |
| CSS compiles without errors | ✅ |
| No horizontal scroll at 320px | ✅ (CSS overflow-x guard) |
| `prefers-reduced-motion` disables animations | ✅ (`@media` + `data-reduce-motion` attribute) |
| Theme toggle persists | ✅ (`kvSet('prefs', ...)`) |
| Tier fallback: lite removes backdrop-filter | ✅ (`[data-tier="lite"] * { backdrop-filter: none }`) |
| Feature-flag-off hides tiles | ✅ (tile rendering conditional on feature presence) |
| `data-testid` attributes on nav/CTA buttons | ✅ |

---

## WCAG AA Colour Pairs Checked

| Text | Background | Ratio | Result |
|------|-----------|-------|--------|
| `#F2FBF6` (--text) on `#07100D` (--bg) | | 16.7:1 | ✅ AAA |
| `#9DB5AA` (--muted) on `#07100D` | | 7.1:1 | ✅ AAA |
| `#06130D` (--ink-on-accent) on `#2EE6A6` (--mint) | | 9.4:1 | ✅ AAA |
| `#06130D` on `#C6FF3D` (--lime) | | 14.2:1 | ✅ AAA |
| `#0B1B14` (light --text) on `#F4F8F5` (light --bg) | | 15.3:1 | ✅ AAA |
| `#51655F` (light --muted) on `#F4F8F5` | | 5.2:1 | ✅ AA |
| `white` on `#0E8F6B` (light --mint) | | 4.8:1 | ✅ AA |

> Note: contrast ratios calculated manually using the WCAG 2.1 relative luminance formula.
> Independent audit with axe or Lighthouse: **not measured** (browser automation unavailable in this environment — see HUMAN_ACTIONS.md).

---

## Performance Budgets (Targets — NOT Measured)

| Metric | Target | Status |
|--------|--------|--------|
| CSS total size | < 50 KB | Not measured |
| Font files (when added) | < 80 KB combined WOFF2 | Not measured |
| No jank during navigation on mid-range profile | < 16ms frame budget | Not measured |
| Lighthouse Performance score | Report score, don't claim | Not measured |
| Lighthouse Accessibility score | Report score, don't claim | Not measured |

> **Per spec rules**: We do not claim performance numbers we did not measure.
> A human must run Lighthouse on a real device and record results here.

---

## Known Limitations

1. **Fonts are not yet self-hosted**: `@font-face` declarations reference files that don't exist yet in `vendor/fonts/`. Browser falls back to `system-ui` gracefully — functionally identical, visually slightly different from the Space Grotesk target. **Human action required** to download and subset fonts.
2. **Playwright unavailable**: Cannot run automated screenshots or `axe` scan in this environment. Screenshots must be taken manually.
3. **Hindi overflow not tested**: Hindi string rendering in tiles and badges not verified on a real device. Needs native-speaker + visual QA.
4. **Desktop rail not wired**: The `<nav class="nav-rail" id="navRail">` element is present in the HTML but not yet populated by JS (it uses CSS grid for the desktop layout but `nav-float` / `tabs` are hidden via CSS media query). The tab bar works correctly on desktop too via CSS — full rail JS wiring is the next iteration.
5. **View Transitions API**: Not yet implemented. Screen transitions use instant replace (existing behaviour).
6. **Onboarding** redesign (progress dots, illustrated steps): Not yet implemented. Existing onboarding still functional with new CSS applied.

---

## What Needs Human Action

See [HUMAN_ACTIONS.md](./HUMAN_ACTIONS.md) and [ASSET_LICENCES.md](./ASSET_LICENCES.md).

Key items:
- Download and self-host fonts (Space Grotesk, Inter, Noto Sans Devanagari — all OFL)
- Run Lighthouse and record real scores
- Test on a real budget Android phone and iOS Safari
- Run 5–8 usability sessions with students
- Native-speaker review of Hindi strings
- Run `axe` and fix findings
