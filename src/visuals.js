import { createFluidSimulation } from './fluid.js';

const DEFAULT_SCENE = {
  minX: -5,
  maxX: 5,
  minY: 0,
  maxY: 4
};

const REFERENCE_DEFAULTS = Object.freeze({
  enabled: true,
  splatInput: 'point-clouds',
  dyeResolution: 1024,
  simResolution: 128,
  densityDissipation: 1,
  velocityDissipation: 0.2,
  pressure: 0.8,
  curl: 30,
  splatRadius: 0.25,
  shading: true,
  colorful: true,
  paused: false,
  bloom: true,
  bloomIntensity: 0.8,
  bloomThreshold: 0.6,
  sunrays: true,
  sunraysWeight: 1
});

const MAX_TOTAL_EMITTERS = 16;
const MAX_EMITTERS_PER_CLOUD = 8;
const MAX_QUEUED_EMITTERS = 32;
const MAX_POINT_DELTA_UV = 0.08;
const MIN_POINT_DELTA_UV = 0.00001;
const MIN_FRAME_DT = 1 / 120;
const MAX_FRAME_DT = 1 / 10;
const COLOR_UPDATE_SPEED = 10;
const BOUNDING_BOX_RADIUS_MIN = 0.01;
const BOUNDING_BOX_RADIUS_MAX = 1;

const FLUID_CONFIG_KEYS = Object.freeze({
  dyeResolution: 'DYE_RESOLUTION',
  simResolution: 'SIM_RESOLUTION',
  densityDissipation: 'DENSITY_DISSIPATION',
  velocityDissipation: 'VELOCITY_DISSIPATION',
  pressure: 'PRESSURE',
  curl: 'CURL',
  splatRadius: 'SPLAT_RADIUS',
  shading: 'SHADING',
  colorful: 'COLORFUL',
  paused: 'PAUSED',
  bloom: 'BLOOM',
  bloomIntensity: 'BLOOM_INTENSITY',
  bloomThreshold: 'BLOOM_THRESHOLD',
  sunrays: 'SUNRAYS',
  sunraysWeight: 'SUNRAYS_WEIGHT'
});

export function createVisuals(host) {
  const canvas = document.createElement('canvas');
  canvas.className = 'data-visuals fluid-visuals';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  const fluid = safeCreateFluid(canvas);
  const views = new Map();
  const defaultOptions = effectiveDefaults(fluid.getConfig?.());
  const presets = Object.freeze({
    default: Object.freeze({
      label: 'Default',
      options: Object.freeze({ ...defaultOptions })
    })
  });

  let scene = { ...DEFAULT_SCENE };
  let options = { ...defaultOptions };
  let pendingEmitters = [];
  let lastAnimationTime = performance.now();
  let colorUpdateTimer = 0;

  function renderSetup(root, selectedSceneAddress) {
    const scenes = [];
    walk(root, (container) => {
      if (container.isScene?.()) scenes.push(container);
    });

    scene = sceneBounds(scenes, selectedSceneAddress);
    clearTracking();
  }

  function renderFrame(frame) {
    const sceneAddress = frame.getSceneInfo?.().getAddress?.() || '';
    const now = performance.now();
    const objects = [];
    const active = new Set();

    frame.getObjects?.().forEach((object, index) => {
      const hasCluster = Boolean(object.hasCluster?.());
      const hasPointCloud = Boolean(object.hasPointCloud?.());
      if (!hasCluster && !hasPointCloud) return;

      const id = object.getID?.();
      const uuid = object.getUUID?.();
      const key = `${sceneAddress}|${uuid || `id:${id ?? index}`}`;
      active.add(key);

      let view = views.get(key);
      if (!view) {
        view = createView(key);
        views.set(key, view);
      }

      const cluster = hasCluster ? object.getCluster() : undefined;
      const cloud = hasPointCloud ? object.getPointCloud() : undefined;
      const points = cloud?.getPointsData?.();

      objects.push({
        view,
        points,
        centroid: cluster ? vector3(cluster.getCentroid?.(), undefined) : undefined,
        size: cluster ? vector3(cluster.getBoundingBoxSize?.(), undefined) : undefined,
        velocity: cluster ? vector3(cluster.getVelocity?.(), [0, 0, 0]) : [0, 0, 0],
        now
      });
    });

    for (const [key] of views) {
      if (key.startsWith(`${sceneAddress}|`) && !active.has(key)) {
        views.delete(key);
      }
    }

    if (!options.enabled) return;

    const sources = emitterSources(objects, options.splatInput);
    if (!sources.length) return;

    const emitters = collectEmitters(sources, options.splatInput, scene);
    if (!emitters.length) return;

    pendingEmitters.push(...emitters);
    if (pendingEmitters.length > MAX_QUEUED_EMITTERS) {
      pendingEmitters = pendingEmitters.slice(-MAX_QUEUED_EMITTERS);
    }
  }

  function animate(now) {
    const dt = Math.min(Math.max((now - lastAnimationTime) / 1000, 0), 1 / 60);
    lastAnimationTime = now;

    updateColors(dt);

    canvas.hidden = !options.enabled || !fluid.supported;
    if (options.enabled && fluid.supported) {
      const emitters = pendingEmitters;
      pendingEmitters = [];
      fluid.update(dt, emitters);
    } else {
      pendingEmitters = [];
    }

    requestAnimationFrame(animate);
  }

  function updateColors(dt) {
    if (!options.colorful) return;

    colorUpdateTimer += dt * COLOR_UPDATE_SPEED;
    if (colorUpdateTimer < 1) return;

    colorUpdateTimer %= 1;
    for (const view of views.values()) {
      for (let index = 0; index < view.colors.length; index++) {
        view.colors[index] = generateColor();
      }
    }
  }

  function setOptions(next = {}) {
    const previousEnabled = options.enabled;
    const previousInput = options.splatInput;

    options = {
      ...options,
      ...pickVisualOptions(next)
    };

    fluid.setConfig?.(fluidConfigFromOptions(next));

    if (previousInput !== options.splatInput) resetInputTracking();
    if (previousEnabled !== options.enabled) reset();
  }

  function getPreset(name) {
    const preset = presets[name];
    return preset ? { label: preset.label, options: { ...preset.options } } : undefined;
  }

  function getPresets() {
    return Object.entries(presets).map(([name, preset]) => ({
      name,
      label: preset.label
    }));
  }

  function randomSplats() {
    fluid.randomSplats?.();
  }

  function clearTracking() {
    views.clear();
    pendingEmitters = [];
    fluid.clear();
  }

  function clearSetup() {
    scene = { ...DEFAULT_SCENE };
    clearTracking();
  }

  function resetInputTracking() {
    pendingEmitters = [];
    for (const view of views.values()) {
      view.previousSamples = [];
      view.previousCentroid = undefined;
      view.lastFrameTime = undefined;
    }
  }

  function reset() {
    resetInputTracking();
    fluid.clear();
  }

  requestAnimationFrame(animate);

  return {
    clearSetup,
    clearTracking,
    getPreset,
    getPresets,
    randomSplats,
    renderFrame,
    renderSetup,
    reset,
    setOptions
  };
}

function createView(key) {
  return {
    key,
    colors: [],
    previousSamples: [],
    previousCentroid: undefined,
    lastFrameTime: undefined
  };
}

function emitterSources(objects, splatInput) {
  const filtered = objects.filter((object) => {
    if (splatInput === 'point-clouds') return object.points?.length;
    return object.centroid && object.size;
  });

  return filtered.slice(0, MAX_TOTAL_EMITTERS);
}

function collectEmitters(objects, splatInput, bounds) {
  if (splatInput === 'point-clouds') {
    const perCloudBudget = emitterBudget(objects.length);
    return objects.flatMap((object) => (
      pointCloudEmitters(object, perCloudBudget, bounds)
    ));
  }

  return objects
    .map((object) => centroidEmitter(
      object,
      bounds,
      splatInput === 'bounding-box'
        ? boundingBoxSplatRadius(object.size, bounds)
        : undefined
    ))
    .filter(Boolean);
}

function pointCloudEmitters({ view, points, velocity, now }, sampleCount, bounds) {
  const pointCount = Math.floor(points.length / 3);
  const indices = selectEmitterIndices(pointCount, sampleCount);
  const frameDt = frameDelta(view, now);

  ensureColors(view, indices.length);

  const fallbackDelta = velocityDelta(velocity, frameDt, bounds);
  const nextSamples = [];
  const emitters = [];

  indices.forEach((pointIndex, slot) => {
    const offset = pointIndex * 3;
    const uv = projectPointToUv(
      [points[offset], points[offset + 1], points[offset + 2]],
      bounds
    );
    nextSamples[slot] = uv;

    if (!uv || !insideUnitSquare(uv)) return;

    const delta = stableDelta(uv, view.previousSamples[slot], fallbackDelta);
    if (Math.hypot(delta.x, delta.y) <= MIN_POINT_DELTA_UV) return;

    emitters.push({
      x: uv.x,
      y: uv.y,
      dx: delta.x,
      dy: delta.y,
      color: view.colors[slot]
    });
  });

  view.previousSamples = nextSamples;
  return emitters;
}

function centroidEmitter({ view, centroid, velocity, now }, bounds, radius) {
  const uv = projectPointToUv(centroid, bounds);
  const frameDt = frameDelta(view, now);
  const fallbackDelta = velocityDelta(velocity, frameDt, bounds);

  if (!uv || !insideUnitSquare(uv)) {
    view.previousCentroid = uv;
    return undefined;
  }

  ensureColors(view, 1);
  const delta = stableDelta(uv, view.previousCentroid, fallbackDelta);
  view.previousCentroid = uv;

  if (Math.hypot(delta.x, delta.y) <= MIN_POINT_DELTA_UV) return undefined;

  return {
    x: uv.x,
    y: uv.y,
    dx: delta.x,
    dy: delta.y,
    color: view.colors[0],
    ...(Number.isFinite(radius) ? { radius } : {})
  };
}

function frameDelta(view, now) {
  const dt = view.lastFrameTime === undefined
    ? 1 / 30
    : clamp((now - view.lastFrameTime) / 1000, MIN_FRAME_DT, MAX_FRAME_DT);
  view.lastFrameTime = now;
  return dt;
}

function velocityDelta(velocity, dt, bounds) {
  const width = Math.max(bounds.maxX - bounds.minX, 0.0001);
  const height = Math.max(bounds.maxY - bounds.minY, 0.0001);

  return {
    x: (Number(velocity?.[0]) || 0) * dt / width,
    y: (Number(velocity?.[1]) || 0) * dt / height
  };
}

function stableDelta(current, previous, fallback) {
  if (!previous) return fallback;

  const dx = current.x - previous.x;
  const dy = current.y - previous.y;
  if (Math.hypot(dx, dy) <= MAX_POINT_DELTA_UV) return { x: dx, y: dy };

  return fallback;
}

function ensureColors(view, count) {
  while (view.colors.length < count) view.colors.push(generateColor());
  view.colors.length = count;
}

export function emitterBudget(cloudCount) {
  const count = Math.max(1, Number(cloudCount) || 1);
  return Math.max(
    1,
    Math.min(MAX_EMITTERS_PER_CLOUD, Math.floor(MAX_TOTAL_EMITTERS / count))
  );
}

export function selectEmitterIndices(pointCount, sampleCount) {
  const count = Math.max(0, Math.floor(Number(pointCount) || 0));
  const samples = Math.min(count, Math.max(0, Math.floor(Number(sampleCount) || 0)));
  if (!count || !samples) return [];

  return Array.from({ length: samples }, (_, index) => (
    Math.min(
      count - 1,
      Math.floor(((index + 0.5) / samples) * count)
    )
  ));
}

export function projectPointToUv(point, bounds) {
  if (!point || point.length < 2) return undefined;

  const x = Number(point[0]);
  const y = Number(point[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;

  const width = Math.max(bounds.maxX - bounds.minX, 0.0001);
  const height = Math.max(bounds.maxY - bounds.minY, 0.0001);

  return {
    x: (x - bounds.minX) / width,
    y: (y - bounds.minY) / height
  };
}

export function boundingBoxSplatRadius(size, bounds) {
  if (!size || size.length < 2) return undefined;

  const width = Math.max(bounds.maxX - bounds.minX, 0.0001);
  const height = Math.max(bounds.maxY - bounds.minY, 0.0001);
  const widthUv = Math.abs(Number(size[0]) || 0) / width;
  const heightUv = Math.abs(Number(size[1]) || 0) / height;

  // Pavel's splat radius is the Gaussian squared-distance denominator * 100.
  // Use an area-equivalent projected radius so a tall human box does not
  // explode into a full-screen splat while still scaling with box footprint.
  const radiusUv = 0.5 * Math.sqrt(widthUv * heightUv);
  return clamp(
    radiusUv * radiusUv * 100,
    BOUNDING_BOX_RADIUS_MIN,
    BOUNDING_BOX_RADIUS_MAX
  );
}

function effectiveDefaults(engineConfig = {}) {
  return {
    ...REFERENCE_DEFAULTS,
    dyeResolution: finiteOr(engineConfig.DYE_RESOLUTION, REFERENCE_DEFAULTS.dyeResolution),
    simResolution: finiteOr(engineConfig.SIM_RESOLUTION, REFERENCE_DEFAULTS.simResolution),
    densityDissipation: finiteOr(
      engineConfig.DENSITY_DISSIPATION,
      REFERENCE_DEFAULTS.densityDissipation
    ),
    velocityDissipation: finiteOr(
      engineConfig.VELOCITY_DISSIPATION,
      REFERENCE_DEFAULTS.velocityDissipation
    ),
    pressure: finiteOr(engineConfig.PRESSURE, REFERENCE_DEFAULTS.pressure),
    curl: finiteOr(engineConfig.CURL, REFERENCE_DEFAULTS.curl),
    splatRadius: finiteOr(engineConfig.SPLAT_RADIUS, REFERENCE_DEFAULTS.splatRadius),
    shading: booleanOr(engineConfig.SHADING, REFERENCE_DEFAULTS.shading),
    colorful: booleanOr(engineConfig.COLORFUL, REFERENCE_DEFAULTS.colorful),
    paused: booleanOr(engineConfig.PAUSED, REFERENCE_DEFAULTS.paused),
    bloom: booleanOr(engineConfig.BLOOM, REFERENCE_DEFAULTS.bloom),
    bloomIntensity: finiteOr(
      engineConfig.BLOOM_INTENSITY,
      REFERENCE_DEFAULTS.bloomIntensity
    ),
    bloomThreshold: finiteOr(
      engineConfig.BLOOM_THRESHOLD,
      REFERENCE_DEFAULTS.bloomThreshold
    ),
    sunrays: booleanOr(engineConfig.SUNRAYS, REFERENCE_DEFAULTS.sunrays),
    sunraysWeight: finiteOr(
      engineConfig.SUNRAYS_WEIGHT,
      REFERENCE_DEFAULTS.sunraysWeight
    )
  };
}

function pickVisualOptions(value) {
  const result = {};
  for (const key of Object.keys(REFERENCE_DEFAULTS)) {
    if (key in value) result[key] = value[key];
  }
  return result;
}

function fluidConfigFromOptions(value) {
  const result = {};
  for (const [optionKey, configKey] of Object.entries(FLUID_CONFIG_KEYS)) {
    if (optionKey in value) result[configKey] = value[optionKey];
  }
  return result;
}

function sceneBounds(scenes, selectedSceneAddress) {
  const selected = selectedSceneAddress
    ? scenes.find((candidate) => candidate.getAddress?.() === selectedSceneAddress)
    : undefined;

  if (selected) return boundsForScene(selected);
  if (!scenes.length) return { ...DEFAULT_SCENE };

  return scenes
    .map(boundsForScene)
    .reduce((combined, current) => ({
      minX: Math.min(combined.minX, current.minX),
      maxX: Math.max(combined.maxX, current.maxX),
      minY: Math.min(combined.minY, current.minY),
      maxY: Math.max(combined.maxY, current.maxY)
    }));
}

function boundsForScene(container) {
  const position = vector3(container.getPosition?.(), [0, 0, 0]);
  const size = vector3(container.getSceneParameters?.()?.size, [10, 4, 8]);

  const x2 = position[0] + size[0];
  const y2 = position[1] + size[1];

  return {
    minX: Math.min(position[0], x2),
    maxX: Math.max(position[0], x2),
    minY: Math.min(position[1], y2),
    maxY: Math.max(position[1], y2)
  };
}

function generateColor() {
  const color = hsvToRgb(Math.random(), 1, 1);
  return {
    r: color.r * 0.15,
    g: color.g * 0.15,
    b: color.b * 0.15
  };
}

function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0: return { r: v, g: t, b: p };
    case 1: return { r: q, g: v, b: p };
    case 2: return { r: p, g: v, b: t };
    case 3: return { r: p, g: q, b: v };
    case 4: return { r: t, g: p, b: v };
    default: return { r: v, g: p, b: q };
  }
}

function safeCreateFluid(canvas) {
  try {
    return createFluidSimulation(canvas);
  } catch (error) {
    console.warn('Fluid simulation unavailable:', error);
    return {
      supported: false,
      clear() {},
      getConfig() { return {}; },
      randomSplats() {},
      setConfig() {},
      update() {}
    };
  }
}

function insideUnitSquare(point) {
  return point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

function walk(container, visit) {
  if (!container) return;
  visit(container);
  for (const child of container.getChildren?.() || []) walk(child, visit);
}

function vector3(value, fallback) {
  if (!value || value.length < 3) return fallback ? [...fallback] : undefined;
  return [0, 1, 2].map((index) => (
    Number.isFinite(Number(value[index]))
      ? Number(value[index])
      : fallback?.[index]
  ));
}

function finiteOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function booleanOr(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
