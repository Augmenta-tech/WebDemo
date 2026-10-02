# Augmenta Web Demo

Browser-based Augmenta demo for real-time spatial interaction.

The application shell stays aligned with
[Augmenta Three.js example](https://github.com/Augmenta-tech/Augmenta-ThreeJS-example):
connection handling, setup parsing, scene selection, debug data, QR sharing,
sidebar behavior, persistence, mobile behavior, and GitHub Pages deployment are
kept intact.

## Visuals

The default visual mode is now a direct adaptation of
[PavelDoGreat/WebGL-Fluid-Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation) at upstream commit `a2d292931f19d9b3b9f564e23e6c32729d2121c3`.

The simulation keeps the reference project's default visual parameters and
rendering pipeline: 128 simulation resolution, 1024 dye resolution, density and
velocity dissipation, pressure solve, vorticity, shading, bloom, sunrays, and the
original dithering texture.

The only intentional input change is the effector source:

- mouse and multitouch input are removed
- Augmenta point clouds are projected to the fluid canvas
- each cloud is evenly subsampled to a bounded number of emitters
- sampled point motion drives the same splat force path used by pointer motion
- emitter colors follow the reference simulation's colorful pointer behavior
- emitter count is shared across simultaneous point clouds to keep the effect
  responsive and visually close to the original

The fluid canvas is the primary visual when **Visuals → Fluid simulation** is
enabled. Disable it to reveal the original Three.js debug viewer underneath.

The adapted fluid engine lives in `src/fluid.js`; the point-cloud-to-emitter
bridge is isolated in `src/visuals.js`.

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

GitHub Pages is deployed from `main` by
`.github/workflows/pages.yml`.
