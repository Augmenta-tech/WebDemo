import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getUserPreset,
  isUserPresetId,
  normalizePresetName,
  normalizeUserPresets,
  removeUserPreset,
  upsertUserPreset
} from '../src/visual-presets.js';

test('preset names are compact and bounded', () => {
  assert.equal(normalizePresetName('  My   fluid   preset  '), 'My fluid preset');
  assert.equal(normalizePresetName(''), '');
  assert.equal(normalizePresetName('x'.repeat(80)).length, 48);
});

test('saved presets get stable local IDs and replace same-name presets', () => {
  const first = upsertUserPreset([], 'Flow', { curl: 20 });
  assert.ok(first);
  assert.equal(first.preset.id, 'user:flow');
  assert.equal(first.preset.label, 'Flow');
  assert.deepEqual(first.preset.options, { curl: 20 });

  const replaced = upsertUserPreset(first.presets, ' flow ', { curl: 42 });
  assert.ok(replaced);
  assert.equal(replaced.presets.length, 1);
  assert.equal(replaced.preset.id, 'user:flow');
  assert.deepEqual(replaced.preset.options, { curl: 42 });
});

test('saved presets normalize malformed persisted data', () => {
  const normalized = normalizeUserPresets([
    { id: 'bad-id', label: '  Saved  ', options: { pressure: 0.5 } },
    { id: 'user:saved', label: '', options: { pressure: 1 } },
    null,
    { id: 'user:other', label: 'Other', options: null }
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].id, 'user:saved');
  assert.equal(normalized[0].label, 'Saved');
  assert.deepEqual(normalized[0].options, { pressure: 0.5 });
});

test('saved presets can be loaded and deleted by ID', () => {
  const saved = upsertUserPreset([], 'Stage', { bloom: false });
  assert.ok(saved);

  assert.equal(isUserPresetId(saved.preset.id), true);
  assert.deepEqual(getUserPreset(saved.presets, saved.preset.id), saved.preset);
  assert.deepEqual(removeUserPreset(saved.presets, saved.preset.id), []);
  assert.equal(getUserPreset(saved.presets, 'default'), undefined);
});
