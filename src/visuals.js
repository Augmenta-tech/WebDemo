const BACKGROUND = '#090b11';
const STALE_MS = 360;
const EASING_MS = 70;
const MAX_POINTS = 1400;

const PALETTES = {
  punchy: ['#38e8ff', '#ff4fd8', '#a4ff56', '#ffb02e', '#7f7cff', '#ff5c69'],
  cool: ['#49ecff', '#4d9cff', '#8c7dff', '#47ffd0', '#84b7ff', '#b58cff'],
  mono: ['#f4f7ff', '#cfd7e8', '#ffffff', '#aab6cc', '#e8edfa', '#bdc7dc']
};

export function createVisuals(host) {
  const canvas = document.createElement('canvas');
  canvas.className = 'data-visuals';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  const trailCanvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const trail = trailCanvas.getContext('2d');

  const objects = new Map();
  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  let rightInset = 0;
  let lastDraw = performance.now();
  let scene = defaultScene();
  let zones = [];

  const visibility = {
    clusters: true,
    points: true,
    scene: true,
    zones: true,
    vectors: true
  };

  const options = {
    enabled: true,
    trails: true,
    grid: true,
    glow: true,
    labels: true,
    palette: 'punchy'
  };

  function resize() {
    const rect = host.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    for (const target of [canvas, trailCanvas]) {
      target.width = Math.max(1, Math.round(width * pixelRatio));
      target.height = Math.max(1, Math.round(height * pixelRatio));
    }

    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    trail.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    trail.clearRect(0, 0, width, height);
  }

  function renderSetup(root, selectedSceneAddress) {
    const scenes = [];
    const nextZones = [];

    walk(root, (container) => {
      if (container.isScene?.()) scenes.push(container);
      if (container.isZone?.()) {
        nextZones.push({
          name: container.getName?.() || 'Zone',
          position: vector3(container.getPosition?.(), [0, 0, 0])
        });
      }
    });

    const selected = scenes.find((candidate) => (
      selectedSceneAddress && candidate.getAddress?.() === selectedSceneAddress
    )) ?? scenes[0];

    scene = selected ? sceneFromContainer(selected) : defaultScene();
    zones = nextZones;
  }

  function renderFrame(frame) {
    const sceneAddress = frame.getSceneInfo?.().getAddress?.() || '';
    const active = new Set();
    const now = performance.now();

    frame.getObjects?.().forEach((object, index) => {
      const id = object.getID?.();
      const uuid = object.getUUID?.();
      const key = `${sceneAddress}|${uuid || `id:${id ?? index}`}`;
      active.add(key);

      let view = objects.get(key);
      if (!view) {
        view = createView(key, id, uuid);
        objects.set(key, view);
      }

      view.id = id;
      view.uuid = uuid;
      view.lastSeen = now;

      if (object.hasCluster?.()) {
        const cluster = object.getCluster();
        view.centerTarget = vector3(cluster.getBoundingBoxCenter?.(), view.centerTarget);
        view.sizeTarget = vector3(cluster.getBoundingBoxSize?.(), view.sizeTarget);
        view.centroidTarget = vector3(cluster.getCentroid?.(), view.centerTarget);
        view.velocityTarget = vector3(cluster.getVelocity?.(), [0, 0, 0]);
      }

      if (object.hasPointCloud?.()) {
        const points = object.getPointCloud().getPointsData?.();
        if (points?.length) view.points = points;
      }
    });

    for (const [key, view] of objects) {
      if (key.startsWith(`${sceneAddress}|`) && !active.has(key)) {
        view.lastSeen = Math.min(view.lastSeen, now - 1);
      }
    }
  }

  function createView(key, id, uuid) {
    return {
      key,
      id,
      uuid,
      colorIndex: hashString(key) % PALETTES.punchy.length,
      lastSeen: performance.now(),
      center: [0, 0.9, 0],
      centerTarget: [0, 0.9, 0],
      size: [0.55, 1.7, 0.55],
      sizeTarget: [0.55, 1.7, 0.55],
      centroid: [0, 0.9, 0],
      centroidTarget: [0, 0.9, 0],
      velocity: [0, 0, 0],
      velocityTarget: [0, 0, 0],
      points: undefined
    };
  }

  function animate(now) {
    const dt = Math.min(Math.max(now - lastDraw, 0), 50);
    lastDraw = now;
    const amount = 1 - Math.exp(-dt / EASING_MS);

    for (const [key, view] of objects) {
      ease(view.center, view.centerTarget, amount);
      ease(view.size, view.sizeTarget, amount);
      ease(view.centroid, view.centroidTarget, amount);
      ease(view.velocity, view.velocityTarget, amount);
      if (now - view.lastSeen > STALE_MS) objects.delete(key);
    }

    canvas.hidden = !options.enabled;
    if (options.enabled) draw(now);
    requestAnimationFrame(animate);
  }

  function draw(now) {
    const projection = makeProjection();

    drawBackground(projection, now);
    if (options.grid) drawGrid(projection, now);
    if (visibility.scene) drawSceneFrame(projection);

    updateTrails(projection);
    if (options.trails) ctx.drawImage(trailCanvas, 0, 0, width, height);

    const views = [...objects.values()];
    for (const view of views) drawObject(view, projection, now);

    if (visibility.zones) drawZones(projection);
    drawHud(projection, views.length);
  }

  function drawBackground(projection, now) {
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, width, height);

    const radial = ctx.createRadialGradient(
      projection.centerX,
      projection.top + projection.stageHeight * 0.55,
      0,
      projection.centerX,
      projection.top + projection.stageHeight * 0.55,
      Math.max(projection.stageWidth, projection.stageHeight) * 0.85
    );
    radial.addColorStop(0, 'rgba(46, 59, 97, .24)');
    radial.addColorStop(.55, 'rgba(22, 28, 48, .09)');
    radial.addColorStop(1, 'rgba(9, 11, 17, 0)');
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, projection.usableWidth, height);

    drawFloorWaves(projection, now);
  }

  function drawFloorWaves(p, now) {
    const palette = currentPalette();
    const startY = p.bottom - p.stageHeight * 0.18;

    ctx.save();
    ctx.lineWidth = 1;

    for (let row = 0; row < 12; row++) {
      const t = row / 11;
      const y = startY + t * (p.bottom - startY);
      ctx.strokeStyle = colorAlpha(palette[row % palette.length], 0.035 + t * 0.055);
      ctx.beginPath();

      for (let column = 0; column <= 56; column++) {
        const x = p.left + (column / 56) * p.stageWidth;
        const wave = Math.sin(column * .58 + row * .72 + now * .0012) * (1.2 + t * 3.2);
        if (column === 0) ctx.moveTo(x, y + wave);
        else ctx.lineTo(x, y + wave);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawGrid(p) {
    ctx.save();
    ctx.strokeStyle = 'rgba(155, 177, 222, .10)';
    ctx.lineWidth = 1;

    for (let i = 0; i <= 12; i++) {
      const x = p.left + p.stageWidth * (i / 12);
      segment(ctx, x, p.top, x, p.bottom);
    }

    for (let i = 0; i <= 8; i++) {
      const y = p.top + p.stageHeight * (i / 8);
      segment(ctx, p.left, y, p.right, y);
    }

    ctx.restore();
  }

  function drawSceneFrame(p) {
    ctx.save();
    ctx.strokeStyle = 'rgba(220, 230, 255, .26)';
    ctx.lineWidth = 1;
    ctx.setLineDash([7, 8]);
    ctx.strokeRect(p.left, p.top, p.stageWidth, p.stageHeight);
    ctx.setLineDash([]);

    const corner = 16;
    ctx.strokeStyle = 'rgba(233, 240, 255, .72)';
    ctx.lineWidth = 1.4;
    cornerMark(ctx, p.left, p.top, 1, 1, corner);
    cornerMark(ctx, p.right, p.top, -1, 1, corner);
    cornerMark(ctx, p.left, p.bottom, 1, -1, corner);
    cornerMark(ctx, p.right, p.bottom, -1, -1, corner);
    ctx.restore();
  }

  function updateTrails(p) {
    trail.save();
    trail.globalCompositeOperation = 'destination-out';
    trail.fillStyle = options.trails ? 'rgba(0, 0, 0, .09)' : 'rgba(0, 0, 0, 1)';
    trail.fillRect(0, 0, width, height);
    trail.restore();

    if (!options.trails || !visibility.points) return;

    trail.save();
    trail.globalCompositeOperation = 'lighter';
    for (const view of objects.values()) {
      if (!view.points?.length) continue;
      drawPointCloud(trail, view, p, .10, 1.15, false);
    }
    trail.restore();
  }

  function drawObject(view, p, now) {
    const fade = Math.min(1, Math.max(0, (STALE_MS - (now - view.lastSeen)) / 120));
    const color = objectColor(view);

    if (visibility.points && view.points?.length) {
      drawPointCloud(ctx, view, p, .88 * fade, options.glow ? 1.75 : 1.4, options.glow);
    }

    if (visibility.clusters) drawBounds(view, p, color, fade);
    if (visibility.vectors) drawVelocity(view, p, color, fade);
  }

  function drawPointCloud(target, view, p, alpha, radius, glow) {
    const data = view.points;
    if (!data?.length) return;

    const color = objectColor(view);
    const pointCount = Math.floor(data.length / 3);
    const stride = Math.max(1, Math.ceil(pointCount / MAX_POINTS)) * 3;

    target.save();
    target.fillStyle = colorAlpha(color, alpha);
    if (glow) {
      target.shadowColor = color;
      target.shadowBlur = 8;
    }

    for (let i = 0; i + 1 < data.length; i += stride) {
      const x = p.x(data[i]);
      const y = p.y(data[i + 1]);
      if (x < p.left || x > p.right || y < p.top || y > p.bottom) continue;
      target.fillRect(x - radius * .5, y - radius * .5, radius, radius);
    }

    target.restore();
  }

  function drawBounds(view, p, color, alpha) {
    const centerX = p.x(view.center[0]);
    const centerY = p.y(view.center[1]);
    const boxWidth = Math.max(Math.abs(view.size[0]) * p.scaleX, 12);
    const boxHeight = Math.max(Math.abs(view.size[1]) * p.scaleY, 20);
    const x = centerX - boxWidth * .5;
    const y = centerY - boxHeight * .5;

    ctx.save();
    ctx.strokeStyle = colorAlpha(color, .78 * alpha);
    ctx.lineWidth = 1.2;

    if (options.glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
    }

    ctx.strokeRect(x, y, boxWidth, boxHeight);

    const corner = Math.min(14, Math.max(7, Math.min(boxWidth, boxHeight) * .13));
    ctx.lineWidth = 2.1;
    cornerMark(ctx, x, y, 1, 1, corner);
    cornerMark(ctx, x + boxWidth, y, -1, 1, corner);
    cornerMark(ctx, x, y + boxHeight, 1, -1, corner);
    cornerMark(ctx, x + boxWidth, y + boxHeight, -1, -1, corner);

    const cx = p.x(view.centroid[0]);
    const cy = p.y(view.centroid[1]);
    ctx.fillStyle = colorAlpha(color, .9 * alpha);
    ctx.beginPath();
    ctx.arc(cx, cy, 2.4, 0, Math.PI * 2);
    ctx.fill();

    if (options.labels) drawLabel(view, x, y, color, alpha);
    ctx.restore();
  }

  function drawLabel(view, x, y, color, alpha) {
    const id = view.id !== undefined ? `ID ${view.id}` : view.uuid?.slice(0, 8) || 'OBJECT';
    ctx.shadowBlur = 0;
    ctx.font = '600 9px Inter, ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = colorAlpha(color, .92 * alpha);
    ctx.fillText(id, x, Math.max(16, y - 8));

    ctx.font = '500 8px Inter, ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(205, 216, 240, .48)';
    ctx.fillText(
      `X ${view.center[0].toFixed(2)}   Y ${view.center[1].toFixed(2)}`,
      x,
      Math.max(26, y + 5)
    );
  }

  function drawVelocity(view, p, color, alpha) {
    const vx = Number(view.velocity[0]) || 0;
    const vy = Number(view.velocity[1]) || 0;
    const speed = Math.hypot(vx, vy);
    if (speed < .01) return;

    const x = p.x(view.centroid[0]);
    const y = p.y(view.centroid[1]);
    const length = Math.min(58, 12 + speed * 30);
    const nx = vx / speed;
    const ny = -vy / speed;

    ctx.save();
    ctx.strokeStyle = colorAlpha(color, .55 * alpha);
    ctx.fillStyle = colorAlpha(color, .55 * alpha);
    ctx.lineWidth = 1.1;
    segment(ctx, x, y, x + nx * length, y + ny * length);

    ctx.translate(x + nx * length, y + ny * length);
    ctx.rotate(Math.atan2(ny, nx));
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-6, -3);
    ctx.lineTo(-6, 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawZones(p) {
    if (!zones.length) return;

    ctx.save();
    ctx.font = '500 8px Inter, ui-sans-serif, system-ui, sans-serif';

    for (const zone of zones.slice(0, 12)) {
      const x = p.x(zone.position[0]);
      if (x < p.left || x > p.right) continue;
      ctx.strokeStyle = 'rgba(191, 166, 255, .40)';
      segment(ctx, x, p.bottom - 8, x, p.bottom + 8);
      ctx.fillStyle = 'rgba(191, 166, 255, .55)';
      ctx.fillText(zone.name, x + 5, p.bottom - 10);
    }

    ctx.restore();
  }

  function drawHud(p, count) {
    ctx.save();
    ctx.font = '600 9px Inter, ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(230, 237, 252, .74)';

    const dimensions = scene.size.map((value) => Number(value).toFixed(1)).join(' × ');
    ctx.fillText(`DIMENSIONS  ${dimensions} m`, 24, 28);
    ctx.fillText(`PEOPLE  ${count}`, 24, 43);

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(193, 207, 235, .46)';
    ctx.fillText('AUGMENTA / LIVE DATA', p.right, 28);
    ctx.restore();
  }

  function makeProjection() {
    const usableWidth = Math.max(180, width - rightInset);
    const left = Math.max(40, usableWidth * .075);
    const right = usableWidth - Math.max(40, usableWidth * .075);
    const top = Math.max(72, height * .12);
    const bottom = height - Math.max(48, height * .09);
    const stageWidth = Math.max(1, right - left);
    const stageHeight = Math.max(1, bottom - top);

    return {
      usableWidth,
      left,
      right,
      top,
      bottom,
      stageWidth,
      stageHeight,
      centerX: (left + right) * .5,
      scaleX: stageWidth / Math.max(scene.maxX - scene.minX, .001),
      scaleY: stageHeight / Math.max(scene.maxY - scene.minY, .001),
      x: (value) => left + ((value - scene.minX) / Math.max(scene.maxX - scene.minX, .001)) * stageWidth,
      y: (value) => bottom - ((value - scene.minY) / Math.max(scene.maxY - scene.minY, .001)) * stageHeight
    };
  }

  function currentPalette() {
    return PALETTES[options.palette] || PALETTES.punchy;
  }

  function objectColor(view) {
    const palette = currentPalette();
    return palette[view.colorIndex % palette.length];
  }

  function setVisibility(next) {
    Object.assign(visibility, next);
  }

  function setOptions(next) {
    Object.assign(options, next);
    if (!options.trails) trail.clearRect(0, 0, width, height);
  }

  function clearTracking() {
    objects.clear();
    trail.clearRect(0, 0, width, height);
  }

  function clearSetup() {
    scene = defaultScene();
    zones = [];
  }

  function reset() {
    trail.clearRect(0, 0, width, height);
  }

  function setRightInset(value) {
    rightInset = Math.max(0, Number(value) || 0);
  }

  new ResizeObserver(resize).observe(host);
  resize();
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

function sceneFromContainer(container) {
  const position = vector3(container.getPosition?.(), [0, 0, 0]);
  const size = vector3(container.getSceneParameters?.()?.size, [10, 4, 8]);

  return {
    minX: position[0],
    maxX: position[0] + Math.max(Math.abs(size[0]), .001),
    minY: position[1],
    maxY: position[1] + Math.max(Math.abs(size[1]), .001),
    size
  };
}

function defaultScene() {
  return {
    minX: -5,
    maxX: 5,
    minY: 0,
    maxY: 4,
    size: [10, 4, 8]
  };
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

function ease(current, target, amount) {
  for (let i = 0; i < current.length; i++) current[i] += (target[i] - current[i]) * amount;
}

function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function segment(context, x1, y1, x2, y2) {
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}

function cornerMark(context, x, y, sx, sy, length) {
  segment(context, x, y, x + sx * length, y);
  segment(context, x, y, x, y + sy * length);
}

function colorAlpha(hex, alpha) {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}
