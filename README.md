# Augmenta Web Demo

Browser-based Augmenta demo for real-time spatial interaction.

This repository is intentionally based on the current
[Augmenta Three.js example](https://github.com/Augmenta-tech/Augmenta-ThreeJS-example)
so connection handling, setup parsing, scene selection, debug data, QR sharing,
sidebar behavior, persistence, mobile behavior, and GitHub Pages deployment stay
aligned with the reference implementation.

The Web Demo adds an independent 2D data-visual layer on top of that base. Disable
**Visuals → Data visuals** at any time to reveal the original Three.js viewer.

## Visuals

The default visual mode is a front-facing technical/data-art view with:

- colored point-cloud silhouettes
- tracked bounding boxes and centroids
- velocity cues
- motion trails
- scene grid and frame
- zone markers
- glow and labels
- Punchy, Cool, and Monochrome palettes

The visual layer is implemented in `src/visuals.js` and does not replace the
reference Three.js renderer in `src/viewer.js`.

## Run

Clone with submodules, then serve the repository over HTTP:

```bash
git clone --recurse-submodules https://github.com/Augmenta-tech/WebDemo.git
cd WebDemo
python -m http.server 8000
```

Open `http://localhost:8000`.

You can connect to an Augmenta WebSocket output or use **Simulate data** without
an Augmenta server.

## Deployment

GitHub Pages is deployed from `main` by the workflow in
`.github/workflows/pages.yml`.
