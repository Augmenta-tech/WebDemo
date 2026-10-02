import { createFluidSimulation } from './fluid.js';

const DEFAULT_SCENE = {
  minX: -5,
  maxX: 5,
  minY: 0,
  maxY: 4
};

const MAX_TOTAL_EMITTERS = 24;
const MAX_EMITTERS_PER_CLOUD = 12;
const MAX_QUEUED_EMITTERS = 48;
const MAX_POINT_DELTA_UV = 0.08;
const MIN_POINT_DELTA_UV = 0.00001;
const COLOR_UPDATE_SPEED = 10;
const MIN_FRAME_DT = 1 / 120;
const MAX_FRAME_DT = 1 / 10;

export function createVisuals(host) {
  const canvas = document.createElement('canvas');
  canvas.className = 'data-visuals fluid-visuals';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  const fluid = safeCreateFluid(canvas);
  const views = new Map();

  let scene = { ...DEFAULT_SCENE };
  let pendingEmitters = [];
  let lastAnimationTime = performance.now();
  let colorUpdateTimer = 0;
  let enabled = true;

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
    const clouds = [];
    const active = new Set();

    frame.getObjects?.().forEach((object, index) => {
      if (!object.hasPointCloud?.()) return;

      const id = object.getID?.();
      const uuid = object.getUUID?.();
      const key = `${sceneAddress}|${uuid || `id:${id ?? index}`}`;
      active.add(key);

      let view = views.get(key);
      if (!view) {
        view = createView(key);
        views.set(key, view);
      }

      const points = object.getPointCloud?.().getPointsData?.();
      if (!points?.length) return;

      let velocity = [0, 0, 0];
      if (object.hasCluster?.()) {
        velocity = vector3(object.getCluster().getVelocity?.(), velocity);
      }

      clouds.push({ view, points, velocity, now });
    });

    for (const [key] of views) {
      if (key.startsWith(`${sceneAddress}|`) && !active.has(key)) {
        views.delete(key);
      }
    }

    if (!enabled || !clouds.length) return;

    const perCloudBudget = emitterBudget(clouds.length);
    const emitters = [];

    for (const cloud of clouds) {
      emitters.push(...emittersForCloud(cloud, perCloudBudget, scene));
    }

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

    canvas.hidden = !enabled || !fluid.supported;
    if (enabled && fluid.supported) {
      const emitters = pendingEmitters;
      pendingEmitters = [];
      fluid.update(dt, emitters);
    } else {
      pendingEmitters = [];
    }

    requestAnimationFrame(animate);
  }

  function updateColors(dt) {
    colorUpdateTimer += dt * COLOR_UPDATE_SPEED;
    if (colorUpdateTimer < 1) return;

    colorUpdateTimer %= 1;
    for (const view of views.values()) {
      for (let index = 0; index < view.colors.length; index++) {
        view.colors[index] = generateColor();
      }
    }
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

  function reset() {
    pendingEmitters = [];
    for (const view of views.values()) view.previousSamples = [];
    fluid.clear();
  }

  function setOptions(next) {
    if (typeof next?.enabled !== 'boolean') return;

    const wasEnabled = enabled;
    enabled = next.enabled;
    if (wasEnabled !== enabled) reset();
  }

  // Kept for compatibility with the Three.js-based application shell.
  // Fluid input always comes from point clouds regardless of 3D display toggles.
  function setVisibility() {}
  function setRightInset() {}

  requestAnimationFrame(animate);

  return {
    clearSetup,
    clearTracking,
    renderFrame,
    renderSetup,
    reset,
    setOptions,
    setRightInset,
    setVisibility
  };
}

function createView(key) {
  return {
    key,
    colors: [],
    previousSamples: [],
    lastFrameTime: undefined
  };
}

function emittersForCloud({ view, points, velocity, now }, sampleCount, bounds) {
  const pointCount = Math.floor(points.length / 3);
  const indices = selectEmitterIndices(pointCount, sampleCount);
  const frameDt = view.lastFrameTime === undefined
    ? 1 / 30
    : clamp((now - view.lastFrameTime) / 1000, MIN_FRAME_DT, MAX_FRAME_DT);
  view.lastFrameTime = now;

  while (view.colors.length < indices.length) view.colors.push(generateColor());
  view.colors.length = indices.length;

  const sceneWidth = Math.max(bounds.maxX - bounds.minX, 0.0001);
  const sceneHeight = Math.max(bounds.maxY - bounds.minY, 0.0001);
  const fallbackDelta = {
    x: (Number(velocity[0]) || 0) * frameDt / sceneWidth,
    y: (Number(velocity[1]) || 0) * frameDt / sceneHeight
  };

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

    const previous = view.previousSamples[slot];
    let dx = fallbackDelta.x;
    let dy = fallbackDelta.y;

    if (previous) {
      const pointDx = uv.x - previous.x;
      const pointDy = uv.y - previous.y;
      const pointDistance = Math.hypot(pointDx, pointDy);

      if (pointDistance <= MAX_POINT_DELTA_UV) {
        dx = pointDx;
        dy = pointDy;
      }
    }

    if (Math.hypot(dx, dy) <= MIN_POINT_DELTA_UV) return;

    emitters.push({
      x: uv.x,
      y: uv.y,
      dx,
      dy,
      color: view.colors[slot]
    });
  });

  view.previousSamples = nextSamples;
  return emitters;
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
  if (!value || value.length < 3) return [...fallback];
  return [0, 1, 2].map((index) => (
    Number.isFinite(Number(value[index])) ? Number(value[index]) : fallback[index]
  ));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
