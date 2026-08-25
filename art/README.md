# Art Assets

This directory contains the artwork for the portfolio.

## Pipeline and Source Files

- The operator generates artwork himself using Nhovem in the Gemini app.
- Source files are placed in `art/source/` (this directory is gitignored).
- **Do not commit raw source files.**
- Only the optimised WebP output belongs in `public/art/`.

## Image Generation Prompts

To regenerate layers consistently in the future, use the following prompts:
*(No artwork exists yet, so prompts will be recorded here by the operator when created.)*

## Optimisation Budget

- **Budget:** 150 KB maximum per optimised file.
- The pipeline script enforces this budget and will fail loudly if it is exceeded.

To optimise newly added source files, run:
```bash
npm run art <path-to-source> <base-name>
```
For example: `npm run art art/source/tavern-room-source.png tavern-room`
This creates `public/art/<base-name>-1280.webp` and `public/art/<base-name>-2560.webp`.

## Contrast Measurement

Every layer's text contrast must be measured after placement to ensure accessibility against the artwork.
A small utility script is provided to sample the real darkest and lightest pixels in a specific rectangle of an image and compute their contrast against a given text colour.

To measure contrast:
```bash
node scripts/measure-contrast.mjs <path-to-image> <x> <y> <width> <height> <text-hex-color>
```
Do not assume colours; sample them directly from the artwork using this utility.
