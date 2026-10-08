# CREDITS — assets/ui & vendor

## Fonts (SIL Open Font License 1.1 — license texts in fonts/OFL-*.txt)
| Font | Author | Source |
|---|---|---|
| Orbitron (variable 400-900) | Matt McInerney | https://github.com/google/fonts/tree/main/ofl/orbitron |
| Oxanium (variable 200-800) | Severin Meyer | https://github.com/google/fonts/tree/main/ofl/oxanium |
| Rajdhani Medium | Indian Type Foundry | https://github.com/google/fonts/tree/main/ofl/rajdhani |
| Rajdhani SemiBold | Indian Type Foundry | https://github.com/google/fonts/tree/main/ofl/rajdhani |
| Rajdhani Bold | Indian Type Foundry | https://github.com/google/fonts/tree/main/ofl/rajdhani |
| Chakra Petch Regular | Cadson Demak | https://github.com/google/fonts/tree/main/ofl/chakrapetch |
| Chakra Petch SemiBold | Cadson Demak | https://github.com/google/fonts/tree/main/ofl/chakrapetch |
| Chakra Petch Bold | Cadson Demak | https://github.com/google/fonts/tree/main/ofl/chakrapetch |
| Share Tech Mono | Carrois Apostrophe | https://github.com/google/fonts/tree/main/ofl/sharetechmono |
| 站酷庆科黄油体 (子集 3500字+ASCII) | ZCOOL / 郑庆科 | https://github.com/google/fonts/tree/main/ofl/zcoolqingkehuangyou |
| Noto Sans SC Black 900 (子集) | Google / Adobe | https://github.com/google/fonts/tree/main/ofl/notosanssc |
| Noto Sans SC Bold 700 (子集) | Google / Adobe | https://github.com/google/fonts/tree/main/ofl/notosanssc |
| Noto Sans SC Medium 500 (子集) | Google / Adobe | https://github.com/google/fonts/tree/main/ofl/notosanssc |

Chinese fonts were subset (fontTools pyftsubset) to the 3500 level-1 characters of the Table of General Standard Chinese Characters + ASCII + CJK punctuation (list in fonts/charset-zh.txt). Noto Sans SC weights were instanced from the variable font.

## Icons (CC BY 3.0 — attribution REQUIRED, must be shown in the game's credits screen)
298 icons from https://game-icons.net (GitHub game-icons/icons), by: badges, carl-olsen, caro-asercion, cathelineau, delapouite, faithtoken, guard13007, lorc, lord-berandas, quoting, sbed, skoll, willdabeast, zeromancer.
Per-icon author and source URL are in icons/index.json. Modification: the black background square was removed; glyph fill is white (#fff).
Suggested in-game credit line: "Icons by Lorc, Delapouite & contributors — game-icons.net, CC BY 3.0".
License: https://creativecommons.org/licenses/by/3.0/ (icons/LICENSE-game-icons.txt)

## Particle textures (CC0)
- tex/particles, tex/particles_black — Kenney "Particle Pack" 1.1, https://kenney.nl/assets/particle-pack (CC0)
- tex/smoke — Kenney "Smoke Particles", https://kenney.nl/assets/smoke-particles (CC0)
- tex/generated — procedurally generated for this project (noise / glow / ring / flare / hexgrid), CC0

## vendor/three
three.js r160 (0.160.1), MIT License, https://github.com/mrdoob/three.js — build/three.module(.min).js + full examples/jsm. Bundled third-party libs under examples/jsm/libs keep their own licenses (draco: Apache-2.0, basis: Apache-2.0, meshopt: MIT, etc.).
