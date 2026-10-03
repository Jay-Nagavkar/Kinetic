# KhelSetu Asset Licences

All assets used in the KhelSetu front-end are listed here.
Verified by hand — updated with every new asset addition.

---

## Fonts

| Font | Licence | Source | Status |
|------|---------|--------|--------|
| Space Grotesk | SIL Open Font Licence 1.1 (OFL) | fonts.google.com / FontSquirrel | ✅ Free for commercial use |
| Inter | SIL Open Font Licence 1.1 (OFL) | rsms.me/inter | ✅ Free for commercial use |
| Noto Sans Devanagari | SIL Open Font Licence 1.1 (OFL) | fonts.google.com | ✅ Free for commercial use |

> **Self-hosting note**: WOFF2 subsets must be placed in `frontend/vendor/fonts/`.
> Subsetting tool: `pyftsubset` (fonttools) or Glyphhanger.
> Download source: Google Fonts or the respective project GitHub repos.
> Verify the exact subset used covers: Latin + Latin Extended, Devanagari (U+0900-097F).

### Licence text reference (OFL 1.1)
Permission is hereby granted, free of charge, to any person obtaining a copy of the Font Software, to use, study, copy, merge, embed, modify, redistribute, and sell modified and unmodified copies of the Font Software. See the full OFL-1.1 text at https://scripts.sil.org/OFL.

---

## SVG Icons

All inline SVG icons in `app.js` and `index.html` use the **Lucide** icon set.

| Set | Licence | Source |
|-----|---------|--------|
| Lucide | ISC Licence | lucide.dev |

The ISC Licence is equivalent to the simplified MIT Licence and allows free use, modification, and distribution for any purpose.

Full Lucide licence text:
```
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part
of Feather (MIT). All other copyright (c) for Lucide are held by Lucide
Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.
```

Icons used: home, activity (fitcheck), users (squad), bar-chart-2 (leaderboard),
shield (privacy), image (feed), message-square (chat), sun, moon,
camera, cpu (AI), utensils, wifi, wifi-off, star, zap, target, handshake.

---

## Illustrations / Generative Images

No external illustration libraries are used. All empty-state and badge SVGs
are hand-authored inline SVG using only basic paths and geometry.

---

## MediaPipe Pose Landmarker

| Asset | Licence | Source |
|-------|---------|--------|
| MediaPipe Pose Landmarker model + WASM runtime | Apache Licence 2.0 | developers.google.com/mediapipe |

---

## Sound / Audio

Web Audio API tones are programmatically generated — no audio files are bundled.

---

## HUMAN ACTION REQUIRED

- [ ] Download and subset Space Grotesk WOFF2 from fonts.google.com and place in `frontend/vendor/fonts/SpaceGrotesk-VariableFont_wght.woff2`
- [ ] Download and subset Inter WOFF2 from rsms.me/inter and place in `frontend/vendor/fonts/Inter-VariableFont_slnt,wght.woff2`
- [ ] Download and subset Noto Sans Devanagari WOFF2 and place in `frontend/vendor/fonts/NotoSansDevanagari-VariableFont_wdth,wght.woff2`
- [ ] Until fonts are self-hosted, the browser will fall back to system-ui (still fully functional; visually slightly different from the Space Grotesk target)
- [ ] Confirm Lucide icon licence compatibility with institutional IP policy
