# Art Assets

This directory contains the artwork for the portfolio.

## Prompts

The authoritative prompts for generating artwork live in the docs repository at:
`docs/portfolio-docs/art-prompt.md`.

## Pipeline and Source Files

- The operator generates artwork himself using Nhovem in the Gemini app.
- Source files are placed in `art/source/` as **JPG**. This directory is gitignored.
- Sprite cut-outs are produced by hand in an image editor and saved as **PNG** with real transparency in `art/cutout/`.
- Both `art/source/` and `art/cutout/` are source folders and are gitignored.
- **Do not commit raw source or cutout files.**
- Only the optimised WebP output belongs in `public/art/`.

## Optimisation Budget

- **Budget:** 150 KB maximum per optimised file.
- The pipeline script enforces this budget and will fail loudly if it is exceeded.

To optimise newly added source files, run:
```bash
npm run art <path-to-source> <base-name>
```
For example: `npm run art art/source/tavern-room.jpg tavern-room`
This creates `public/art/<base-name>-1280.webp` and `public/art/<base-name>-2560.webp`.

## Contrast Measurement

Every layer's text contrast must be measured after placement to ensure accessibility against the artwork.
To measure contrast:
```bash
node scripts/measure-contrast.mjs <path-to-image> <x> <y> <width> <height> <text-hex-color>
```
Do not assume colours; sample them directly from the artwork using this utility.
## Final Asset List

The `public/art/` directory contains exactly the following 47 files. These are the only
files permitted in that folder. Sprites are derived from hand-cut PNGs in `art/cutout/`.
Both `art/source/` and `art/cutout/` are gitignored source folders.

Rows are in byte-order by filename so this table can be diffed directly against `ls public/art/`.

| Filename | Dimensions | Bytes | Type |
|----------|------------|-------|------|
| adventurers-badge-192.webp | 192×235 | 10,022 B | sprite |
| adventurers-badge-384.webp | 384×470 | 17,614 B | sprite |
| enchanted-case-study-device-1152.webp | 1152×577 | 38,152 B | sprite |
| enchanted-case-study-device-576.webp | 576×289 | 21,266 B | sprite |
| innkeeper-neutral-258.webp | 258×683 | 34,060 B | sprite |
| innkeeper-neutral-516.webp | 516×1365 | 51,640 B | sprite |
| innkeeper-portrait-519.webp | 519×1365 | 37,626 B | sprite |
| innkeeper-presenting-device-259.webp | 259×681 | 31,058 B | sprite |
| innkeeper-presenting-device-519.webp | 519×1365 | 46,056 B | sprite |
| messengers-corner-1280.webp | 1280×714 | 33,810 B | background |
| messengers-corner-2560.webp | 2560×1429 | 88,452 B | background |
| npc-table-1280.webp | 1280×714 | 35,504 B | background |
| npc-table-2560.webp | 2560×1429 | 81,964 B | background |
| npc-table-front-1280.webp | 1280×714 | 13,488 B | foreground plate, alpha |
| npc-table-front-2560.webp | 2560×1429 | 31,684 B | foreground plate, alpha |
| quest-board-1192.webp | 1192×662 | 36,972 B | sprite |
| quest-board-2384.webp | 2384×1323 | 89,746 B | sprite |
| quest-board-prop-256.webp | 256×443 | 16,730 B | sprite |
| quest-board-prop-512.webp | 512×885 | 37,472 B | sprite |
| raven-delivering-letter-388.webp | 388×144 | 19,124 B | sprite |
| raven-delivering-letter-776.webp | 776×288 | 31,698 B | sprite |
| raven-perched-231.webp | 231×255 | 15,188 B | sprite |
| raven-perched-463.webp | 463×512 | 23,840 B | sprite |
| shield-coming-soon-128.webp | 128×158 | 5,076 B | sprite |
| shield-coming-soon-256.webp | 256×316 | 12,234 B | sprite |
| shield-data-128.webp | 128×161 | 5,236 B | sprite |
| shield-data-256.webp | 256×321 | 12,580 B | sprite |
| shield-frameworks-128.webp | 128×177 | 6,200 B | sprite |
| shield-frameworks-256.webp | 256×354 | 16,962 B | sprite |
| shield-languages-128.webp | 128×163 | 5,552 B | sprite |
| shield-languages-256.webp | 256×325 | 14,394 B | sprite |
| shield-other-128.webp | 128×159 | 5,446 B | sprite |
| shield-other-256.webp | 256×319 | 13,970 B | sprite |
| shield-tools-128.webp | 128×185 | 5,792 B | sprite |
| shield-tools-256.webp | 256×370 | 13,018 B | sprite |
| tavern-entrance-closed-1280.webp | 1280×714 | 27,462 B | background |
| tavern-entrance-closed-2560.webp | 2560×1429 | 66,868 B | background |
| tavern-entrance-open-1280.webp | 1280×714 | 28,868 B | background |
| tavern-entrance-open-2560.webp | 2560×1429 | 70,622 B | background |
| tavern-regular-bust-1024.webp | 1024×1205 | 73,784 B | sprite, alpha, npc bust crop |
| tavern-regular-bust-512.webp | 512×603 | 36,188 B | sprite, alpha, npc bust crop |
| tavern-regular-neutral-470.webp | 470×703 | 46,712 B | sprite |
| tavern-regular-neutral-940.webp | 940×1406 | 82,016 B | sprite |
| tavern-regular-seated-264.webp | 264×371 | 21,050 B | sprite |
| tavern-regular-seated-528.webp | 528×741 | 28,992 B | sprite |
| tavern-room-1280.webp | 1280×715 | 48,956 B | background |
| tavern-room-2560.webp | 2560×1431 | 107,660 B | background |
| tavern-sign-1694.webp | 1694×1267 | 77,312 B | sprite |
| tavern-sign-847.webp | 847×634 | 48,372 B | sprite |

### Scene composition

| Route | Layers | Bytes at largest variant | Share of 600 KB per-scene budget |
|-------|--------|--------------------------|----------------------------------|
| `/tavern` | 1 of 5 (D106) | 364,162 B (larger twin of each pair, plus untwinned files; desktop transfer) | 60.7% |
| `/tavern/npc` | 2 of 5 | 199,414 B | 32.5% |

`npc-table-*` is the `/tavern/npc` close-up background and `npc-table-front-*` is the foreground table plate drawn above the sprite; `tavern-regular-bust-*` is the
seated Tavern Regular composited over it. The camera sits beside the Regular's table rather
than directly opposite it, and the painting reserves no dark region, so the dialogue panel
on that route must be fully opaque rather than translucent.

Most backgrounds in this directory are 2560×1429 (0.5582). `tavern-room-*` alone is
2560×1431 (0.5590). `.scene-container` declares no height, so each route takes its height
from its own image; do not assume one ratio across routes.

Produced by:

    npm run art art/source/tavern-npc-table-v5-2752.png npc-table
    (Source is tavern-npc-table-v5-2752.png, cropped 2026-09-02 from tavern-npc-table-v5.jpg which was delivered at 2754x1536; one pixel was removed from each side to reach the house 2752x1536. v5 repairs the shelf gap present in v3.)
    npm run art art/cutout/npc-table-front.png npc-table-front 2560,1280
    npm run art art/cutout/tavern-regular-bust.png tavern-regular-bust 1024,512