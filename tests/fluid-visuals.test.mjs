import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  emitterBudget,
  projectPointToUv,
  selectEmitterIndices
} from '../src/visuals.js';

test('emitter budget stays bounded and shares capacity across clouds', () => {
  assert.equal(emitterBudget(1), 12);
  assert.equal(emitterBudget(2), 12);
  assert.equal(emitterBudget(3), 8);
  assert.equal(emitterBudget(6), 4);
  assert.equal(emitterBudget(24), 1);
  assert.equal(emitterBudget(100), 1);
});

test('point-cloud subsampling is deterministic and evenly distributed', () => {
  assert.deepEqual(selectEmitterIndices(12, 4), [1, 4, 7, 10]);
  assert.deepEqual(selectEmitterIndices(4, 12), [0, 1, 2, 3]);
  assert.deepEqual(selectEmitterIndices(0, 4), []);

  const indices = selectEmitterIndices(1000, 12);
  assert.equal(indices.length, 12);
  assert.equal(new Set(indices).size, 12);
  assert.ok(indices.every((index) => index >= 0 && index < 1000));
});

test('point positions map to fluid UV coordinates using scene bounds', () => {
  const bounds = { minX: -5, maxX: 5, minY: 0, maxY: 4 };
  assert.deepEqual(projectPointToUv([0, 2, 1], bounds), { x: 0.5, y: 0.5 });
  assert.deepEqual(projectPointToUv([-5, 0, 0], bounds), { x: 0, y: 0 });
  assert.deepEqual(projectPointToUv([5, 4, 0], bounds), { x: 1, y: 1 });
  assert.equal(projectPointToUv([Number.NaN, 0, 0], bounds), undefined);
});

test('fluid engine preserves PavelDoGreat default visual parameters and removes pointer input', () => {
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
});
