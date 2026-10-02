# Augmenta Web Demo

Interactive browser demo for Augmenta real-time spatial tracking.

The app connects directly to the Augmenta WebSocket output, renders a smooth 2D front-view data visualization, exposes live debug data, and includes a local synthetic stream for demos without an Augmenta server.

## Visual direction

The default renderer combines colored point-cloud silhouettes, tracked bounds, motion cues, trails, a technical data grid, and subtle glow. Rendering options are available in the **Visuals** section.

## Run locally

Serve the repository from a local HTTP server. The app is static and is also designed for GitHub Pages deployment.

## Data

The Augmenta JavaScript SDK is included as a git submodule under `vendor/AugmentaClientSDK-JS`.
