# Augmenta Web Demo

Browser-based Augmenta demo for real-time spatial interaction.

The application shell stays aligned with
[Augmenta Three.js example](https://github.com/Augmenta-tech/Augmenta-ThreeJS-example):
connection handling, setup parsing, scene selection, debug data, QR sharing,
sidebar behavior, persistence, mobile behavior, and GitHub Pages deployment are
kept intact.

## Visuals

The fluid renderer is a direct adaptation of
[PavelDoGreat/WebGL-Fluid-Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation)
at upstream commit `a2d292931f19d9b3b9f564e23e6c32729d2121c3`.

The Visuals panel exposes the same interactive parameters as the reference web
demo, except the Capture section:

- quality and simulation resolution
- density and velocity diffusion
- pressure, vorticity, and splat radius
- shading, colorful mode, pause, and random splats
- bloom enabled/intensity/threshold
- sunrays enabled/weight

The preset system ships with **Default**, which is the current reference
configuration. Any manual change is shown as **Custom**.

Named presets can be saved from the Visuals panel and loaded again from the
preset selector. Saved presets use the app's existing local persistence object,
so they stay in the current browser alongside the other Web Demo preferences.
Saved presets can also be deleted locally.

### Augmenta splat input

The **Visuals → Augmenta → Splat input** control selects how tracking drives the
same Pavel splat pipeline:

- **Centroid** — one splat per tracked cluster, centered on its centroid
- **Point clouds** — evenly subsampled point-cloud points act as multiple splat
  effectors
- **Bounding box** — one centroid splat whose radius is derived from the
  projected bounding-box footprint

Point and centroid motion provide the splat velocity; cluster velocity is used
as a fallback when point correspondence is not stable.

## Augmenta data

The former Display section and Live debug data section are combined as
**Augmenta data**, placed before Visuals so tracking/debug controls remain the
first data-oriented section after Connection.

Scene selection and the Clusters, Point clouds, Scenes, Zones, and Velocity
vectors toggles use the original Three.js example renderer. Enabled overlays are
rendered transparently **above the fluid canvas**, so they can be used as live
debug information without replacing the visual simulation.

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

## Branding

The app uses the same `augmenta-favicon.png` asset as the Augmenta Three.js
example for browser icons and the sidebar footer.
