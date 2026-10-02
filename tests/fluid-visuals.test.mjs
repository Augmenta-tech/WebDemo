import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
  boundingBoxSplatRadius,
  emitterBudget,
  projectPointToUv,
  selectEmitterIndices
} from '../src/visuals.js';

test('emitter budget stays bounded and shares capacity across clouds', () => {
  assert.equal(emitterBudget(1), 8);
  assert.equal(emitterBudget(2), 8);
  assert.equal(emitterBudget(3), 5);
  assert.equal(emitterBudget(6), 2);
  assert.equal(emitterBudget(16), 1);
});

test('point-cloud subsampling is deterministic and evenly distributed', () => {
  assert.deepEqual(selectEmitterIndices(12, 4), [1, 4, 7, 10]);
  assert.deepEqual(selectEmitterIndices(4, 12), [0, 1, 2, 3]);
  assert.deepEqual(selectEmitterIndices(0, 4), []);

  const indices = selectEmitterIndices(1000, 8);
  assert.equal(indices.length, 8);
  assert.equal(new Set(indices).size, 8);
  assert.ok(indices.every((index) => index >= 0 && index < 1000));
});

test('point positions map to fluid UV coordinates using scene bounds', () => {
  const bounds = { minX: -5, maxX: 5, minY: 0, maxY: 4 };
  assert.deepEqual(projectPointToUv([0, 2, 1], bounds), { x: 0.5, y: 0.5 });
  assert.deepEqual(projectPointToUv([-5, 0, 0], bounds), { x: 0, y: 0 });
  assert.deepEqual(projectPointToUv([5, 4, 0], bounds), { x: 1, y: 1 });
  assert.equal(projectPointToUv([Number.NaN, 0, 0], bounds), undefined);
});

test('bounding-box splat radius follows projected box footprint', () => {
  const bounds = { minX: -5, maxX: 5, minY: 0, maxY: 4 };

  assert.ok(Math.abs(boundingBoxSplatRadius([0.5, 1.6, 0.5], bounds) - 0.5) < 1e-9);
  assert.equal(boundingBoxSplatRadius([0.01, 0.01, 0.01], bounds), 0.01);
  assert.equal(boundingBoxSplatRadius([10, 4, 1], bounds), 1);
});

test('fluid engine preserves Pavel defaults and exposes the GUI control API', () => {
  const source = readFileSync(new URL('../src/fluid.js', import.meta.url), 'utf8');

  for (const expected of [
    'SIM_RESOLUTION: 128',
    'DYE_RESOLUTION: 1024',
    'DENSITY_DISSIPATION: 1',
    'VELOCITY_DISSIPATION: 0.2',
    'PRESSURE: 0.8',
    'PRESSURE_ITERATIONS: 20',
    'CURL: 30',
    'SPLAT_RADIUS: 0.25',
    'SPLAT_FORCE: 6000',
    'SHADING: true',
    'COLORFUL: true',
    'COLOR_UPDATE_SPEED: 10',
    'BLOOM: true',
    'BLOOM_ITERATIONS: 8',
    'BLOOM_RESOLUTION: 256',
    'BLOOM_INTENSITY: 0.8',
    'BLOOM_THRESHOLD: 0.6',
    'BLOOM_SOFT_KNEE: 0.7',
    'SUNRAYS: true',
    'SUNRAYS_RESOLUTION: 196',
    'SUNRAYS_WEIGHT: 1.0'
  ]) {
    assert.ok(source.includes(expected), `missing original default: ${expected}`);
  }

  assert.ok(!source.includes("canvas.addEventListener('mousedown'"));
  assert.ok(!source.includes("canvas.addEventListener('touchstart'"));
  assert.ok(source.includes('function applyEmitters (emitters)'));
  assert.ok(source.includes('function setConfig (next = {})'));
  assert.ok(source.includes('function randomSplats (amount ='));
  assert.ok(source.includes('splat(x, y, dx, dy, color, emitter.radius)'));
});

test('Visuals exposes Pavel controls, presets, and Augmenta splat inputs', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  for (const id of [
    'visual-preset',
    'visual-preset-save',
    'visual-preset-delete',
    'visual-dye-resolution',
    'visual-sim-resolution',
    'visual-density-dissipation',
    'visual-velocity-dissipation',
    'visual-pressure',
    'visual-curl',
    'visual-splat-radius',
    'visual-shading',
    'visual-colorful',
    'visual-paused',
    'visual-random-splats',
    'visual-bloom',
    'visual-bloom-intensity',
    'visual-bloom-threshold',
    'visual-sunrays',
    'visual-sunrays-weight',
    'visual-splat-input'
  ]) {
    assert.ok(html.includes(`id="${id}"`), `missing visual control: ${id}`);
  }

  assert.ok(html.includes('<option value="centroid">Centroid</option>'));
  assert.ok(html.includes('<option value="point-clouds" selected>Point clouds</option>'));
  assert.ok(html.includes('<option value="bounding-box">Bounding box</option>'));
  assert.ok(!html.includes('id="display-section"'));
  assert.ok(html.includes('<span class="panel-title">Augmenta data</span>'));
  assert.ok(
    html.indexOf('id="debug-section"') < html.indexOf('id="visuals-section"'),
    'Augmenta data should appear before Visuals'
  );
  assert.ok(html.includes('./augmenta-favicon.png?v=5'));
  assert.ok(existsSync(new URL('../augmenta-favicon.png', import.meta.url)));
});

test('Three.js debug renderer is transparent so selected data draws above fluid', () => {
  const viewer = readFileSync(new URL('../src/viewer.js', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

  assert.ok(viewer.includes('new THREE.WebGLRenderer({ antialias: true, alpha: true })'));
  assert.ok(viewer.includes("renderer.domElement.classList.add('debug-viewer-canvas')"));
  assert.ok(viewer.includes('renderer.setClearColor(0x000000, 0)'));
  assert.ok(viewer.includes('sceneHelperGroup.visible = scene'));
  assert.ok(styles.includes('#canvas-host .debug-viewer-canvas'));
});
