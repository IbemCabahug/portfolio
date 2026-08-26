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

The `public/art/` directory contains exactly the following 26 files. These are the only files permitted in that folder. Sprites are derived from hand-cut PNGs in `art/cutout/`. Both `art/source/` and `art/cutout/` are gitignored source folders.

| Filename | Dimensions | Bytes | Type |
|----------|------------|-------|------|
| adventurers-badge-192.webp | 192x235 | 10022 | sprite |
| adventurers-badge-384.webp | 384x470 | 17614 | sprite |
| enchanted-case-study-device-1152.webp | 1152x577 | 38152 | sprite |
| enchanted-case-study-device-576.webp | 576x289 | 21266 | sprite |
| innkeeper-neutral-258.webp | 258x683 | 34060 | sprite |
| innkeeper-neutral-516.webp | 516x1365 | 51640 | sprite |
| innkeeper-presenting-device-259.webp | 259x681 | 31058 | sprite |
| innkeeper-presenting-device-519.webp | 519x1365 | 46056 | sprite |
| messengers-corner-1280.webp | 1280x714 | 33810 | background |
| messengers-corner-2560.webp | 2560x1429 | 88452 | background |
| quest-board-1192.webp | 1192x662 | 36972 | sprite |
| quest-board-2384.webp | 2384x1323 | 89746 | sprite |
| raven-delivering-letter-388.webp | 388x144 | 19124 | sprite |
| raven-delivering-letter-776.webp | 776x288 | 31698 | sprite |
| raven-perched-231.webp | 231x255 | 15188 | sprite |
| raven-perched-463.webp | 463x512 | 23840 | sprite |
| tavern-entrance-closed-1280.webp | 1280x714 | 27462 | background |
| tavern-entrance-closed-2560.webp | 2560x1429 | 66868 | background |
| tavern-entrance-open-1280.webp | 1280x714 | 28868 | background |
| tavern-entrance-open-2560.webp | 2560x1429 | 70622 | background |
| tavern-regular-neutral-470.webp | 470x703 | 46712 | sprite |
| tavern-regular-neutral-940.webp | 940x1406 | 82016 | sprite |
| tavern-room-1280.webp | 1280x715 | 57898 | background |
| tavern-room-2560.webp | 2560x1430 | 130582 | background |
| tavern-sign-1694.webp | 1694x1267 | 77312 | sprite |
| tavern-sign-847.webp | 847x634 | 48372 | sprite |
