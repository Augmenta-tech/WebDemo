const USER_PRESET_PREFIX = 'user:';
const MAX_PRESET_NAME_LENGTH = 48;

export function normalizeUserPresets(value) {
  if (!Array.isArray(value)) return [];

  const result = [];
  const seenIds = new Set();
  const seenLabels = new Set();

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;

    const label = normalizePresetName(item.label);
    const options = isPlainObject(item.options) ? { ...item.options } : undefined;
    if (!label || !options) continue;

    const labelKey = label.toLowerCase();
    if (seenLabels.has(labelKey)) continue;
    seenLabels.add(labelKey);

    let id = typeof item.id === 'string' && item.id.startsWith(USER_PRESET_PREFIX)
      ? item.id
      : createPresetId(label, result);

    if (seenIds.has(id)) id = createPresetId(label, result);
    seenIds.add(id);

    result.push({ id, label, options });
  }

  return result;
}

export function upsertUserPreset(presets, label, options) {
  const cleanLabel = normalizePresetName(label);
  if (!cleanLabel || !isPlainObject(options)) return undefined;

  const current = normalizeUserPresets(presets);
  const existingIndex = current.findIndex(
    (preset) => preset.label.toLowerCase() === cleanLabel.toLowerCase()
  );

  const preset = existingIndex >= 0
    ? { ...current[existingIndex], label: cleanLabel, options: { ...options } }
    : {
        id: createPresetId(cleanLabel, current),
        label: cleanLabel,
        options: { ...options }
      };

  if (existingIndex >= 0) current.splice(existingIndex, 1, preset);
  else current.push(preset);

  current.sort((left, right) => left.label.localeCompare(right.label));
  return { presets: current, preset };
}

export function removeUserPreset(presets, id) {
  if (!isUserPresetId(id)) return normalizeUserPresets(presets);
  return normalizeUserPresets(presets).filter((preset) => preset.id !== id);
}

export function getUserPreset(presets, id) {
  if (!isUserPresetId(id)) return undefined;
  return normalizeUserPresets(presets).find((preset) => preset.id === id);
}

export function isUserPresetId(id) {
  return typeof id === 'string' && id.startsWith(USER_PRESET_PREFIX);
}

export function normalizePresetName(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_PRESET_NAME_LENGTH);
}

function createPresetId(label, presets) {
  const slug = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'preset';

  const used = new Set(presets.map((preset) => preset.id));
  let index = 1;
  let id = `${USER_PRESET_PREFIX}${slug}`;

  while (used.has(id)) {
    index += 1;
    id = `${USER_PRESET_PREFIX}${slug}-${index}`;
  }

  return id;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
