const PALETTE = ['#32e6ff', '#ff4fd8', '#ffb020', '#8dff5a', '#7d7cff', '#ff5b64'];
const BACKGROUND = '#090b11';
const FADE_OUT_MS = 360;
const DEFAULT_SCENE_SIZE = [10, 4, 8];

export function createViewer(host) {
  const canvas = document.createElement('canvas');
  canvas.className = 'visual-canvas';
  host.replaceChildren(canvas);

  const ctx = canvas.getContext('2d', { alpha: false });
  const trailsCanvas = document.createElement('canvas');
  const trails = trailsCanvas.getContext('2d');
  const objects = new Map();

  let pixelRatio = 1;
  let width = 1;
  let height = 1;
  let rightInset = 0;
  let sceneSize = [...DEFAULT_SCENE_SIZE];
  let sceneName = 'Scene';
  let sceneAddress = '';
  let setupZones = [];
  let lastFrameTime = performance.now();

  const visibility = {
    clusters: true,
    points: true,
    scene: true,
    zones: true,
    vectors: true
  };

  const visuals = {
    glow: true,
    trails: true,
    grid: true,
    labels: true,
    particles: true,
    bounds: true,
    palette: 'punchy'
  };

  function resize() {
    const rect = host.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    for (const target of [canvas, trailsCanvas]) {
      target.width = Math.max(1, Math.round(width * pixelRatio));
      target.height = Math.max(1, Math.round(height * pixelRatio));
    }

    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    trails.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    trails.clearRect(0, 0, width, height);
  }

  function renderSetup(root, selectedSceneAddress) {
    const scenes = [];
    const zones = [];

    walkSetup(root, (container) => {
      if (container.isScene?.()) scenes.push(container);
      if (container.isZone?.()) zones.push(container);
    });

    const selected = scenes.find((scene) => scene.getAddress?.() === selectedSceneAddress)
      ?? scenes[0];

    if (selected) {
      const size = selected.getSceneParameters?.()?.size;
      if (Array.isArray(size) && size.length >= 2) sceneSize = size.map((v) => Number(v) || 0);
      sceneName = selected.getName?.() || 'Scene';
      sceneAddress = selected.getAddress?.() || '';
    }

    setupZones = zones.map((zone) => ({
      name: zone.getName?.() || 'Zone',
      position: safeVector(zone.getPosition?.(), [0, 0, 0])
    }));
  }

  function clearSetup() {
    sceneSize = [...DEFAULT_SCENE_SIZE];
    sceneName = 'Scene';
    sceneAddress = '';
    setupZones = [];
  }

  function renderFrame(frame) {
    const address = frame.getSceneInfo?.().getAddress?.() || '';
    const now = performance.now();
    const active = new Set();

    frame.getObjects?.().forEach((object, index) => {
      const id = object.getID?.();
      const uuid = object.getUUID?.();
      const key = `${address}|${uuid || `id:${id ?? index}`}`;
      active.add(key);

      let view = objects.get(key);
      if (!view) {
        view = createObjectView(key, id, uuid, objects.size);
        objects.set(key, view);
      }

      view.lastSeen = now;
      view.id = id;
      view.uuid = uuid;

      if (object.hasCluster?.()) {
        const cluster = object.getCluster();
        view.centerTarget = safeVector(cluster.getBoundingBoxCenter?.(), view.centerTarget);
        view.sizeTarget = safeVector(cluster.getBoundingBoxSize?.(), view.sizeTarget);
        view.centroidTarget = safeVector(cluster.getCentroid?.(), view.centerTarget);
        view.velocityTarget = safeVector(cluster.getVelocity?.(), [0, 0, 0]);
        view.lookAtTarget = safeVector(cluster.getLookAt?.(), [0, 0, 0]);
      }

      if (object.hasPointCloud?.()) {
        const points = object.getPointCloud().getPointsData?.();
        if (points?.length) view.points = points;
      }
    });

    for (const [key, view] of objects) {
      if (key.startsWith(`${address}|`) && !active.has(key)) view.lastSeen = Math.min(view.lastSeen, now - 1);
    }
  }

  function createObjectView(key, id, uuid, index) {
    return {
      key,
      id,
      uuid,
      color: PALETTE[index % PALETTE.length],
      lastSeen: performance.now(),
      center: [0, 0.8, 0],
      centerTarget: [0, 0.8, 0],
      size: [0.55, 1.7, 0.5],
      sizeTarget: [0.55, 1.7, 0.5],
      centroid: [0, 0.8, 0],
      centroidTarget: [0, 0.8, 0],
      velocity: [0, 0, 0],
      velocityTarget: [0, 0, 0],
      lookAtTarget: [0, 0, 1],
      points: undefined
    };
  }

  function animate(now) {
    const dt = Math.min(Math.max(now - lastFrameTime, 0), 50);
    lastFrameTime = now;
    const easing = 1 - Math.exp(-dt / 65);

    for (const [key, view] of objects) {
      easeVector(view.center, view.centerTarget, easing);
      easeVector(view.size, view.sizeTarget, easing);
      easeVector(view.centroid, view.centroidTarget, easing);
      easeVector(view.velocity, view.velocityTarget, easing);
      if (now - view.lastSeen > FADE_OUT_MS) objects.delete(key);
    }

    draw(now);
    requestAnimationFrame(animate);
  }

  function draw(now) {
    drawBackground();
    const projection = makeProjection();

    if (visuals.trails) updateTrails(projection);
    else trails.clearRect(0, 0, width, height);

    if (visuals.grid) drawGrid(projection);
    if (visibility.scene) drawSceneFrame(projection);
    if (visuals.trails) ctx.drawImage(trailsCanvas, 0, 0, width, height);

    const visibleObjects = [...objects.values()]
      .filter((view) => now - view.lastSeen <= FADE_OUT_MS);

    for (const view of visibleObjects) drawObject(view, projection, now);
    if (visibility.zones) drawZones(projection);
    drawHud(visibleObjects.length);
  }

  function drawBackground() {
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, width, height);

    const usableWidth = Math.max(1, width - rightInset);
    const radial = ctx.createRadialGradient(
      usableWidth * 0.5, height * 0.52, 0,
      usableWidth * 0.5, height * 0.52, Math.max(usableWidth, height) * 0.72
    );
    radial.addColorStop(0, 'rgba(44, 53, 83, .22)');
    radial.addColorStop(.48, 'rgba(25, 30, 48, .10)');
    radial.addColorStop(1, 'rgba(9, 11, 17, 0)');
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, usableWidth, height);
  }

  function makeProjection() {
    const usableWidth = Math.max(160, width - rightInset);
    const marginX = Math.max(42, usableWidth * 0.08);
    const top = Math.max(84, height * 0.14);
    const bottom = height - Math.max(58, height * 0.11);
    const sceneWidth = Math.max(Math.abs(sceneSize[0] || DEFAULT_SCENE_SIZE[0]), 1);
    const sceneHeight = Math.max(Math.abs(sceneSize[1] || DEFAULT_SCENE_SIZE[1]), 1);
    const scale = Math.min((usableWidth - marginX * 2) / sceneWidth, (bottom - top) / sceneHeight);
    const centerX = usableWidth * 0.5;

    return {
      usableWidth,
      marginX,
      top,
      bottom,
      sceneWidth,
      sceneHeight,
      scale,
      x: (worldX) => centerX + worldX * scale,
      y: (worldY) => bottom - worldY * scale
    };
  }

  function updateTrails(p) {
    trails.save();
    trails.globalCompositeOperation = 'destination-out';
    trails.fillStyle = 'rgba(0,0,0,.085)';
    trails.fillRect(0, 0, width, height);
    trails.restore();

    trails.save();
    trails.globalCompositeOperation = 'lighter';
    for (const view of objects.values()) {
      if (!view.points?.length) continue;
      drawPointCloud(trails, { ...view, color: paletteColor(view.color, visuals.palette) }, p, .12, 1.2, false);
    }
    trails.restore();
  }

  function drawGrid(p) {
    ctx.save();
    ctx.strokeStyle = 'rgba(139, 160, 205, .11)';
    ctx.lineWidth = 1;

    const columns = 12;
    const rows = 8;
    for (let i = 0; i <= columns; i++) {
      const x = p.marginX + (p.usableWidth - p.marginX * 2) * (i / columns);
      line(ctx, x, p.top, x, p.bottom);
    }
    for (let i = 0; i <= rows; i++) {
      const y = p.top + (p.bottom - p.top) * (i / rows);
      line(ctx, p.marginX, y, p.usableWidth - p.marginX, y);
    }

    ctx.strokeStyle = 'rgba(195, 215, 255, .26)';
    ctx.lineWidth = 1.2;
    line(ctx, p.marginX, p.bottom, p.usableWidth - p.marginX, p.bottom);
    ctx.restore();
  }

  function drawSceneFrame(p) {
    ctx.save();
    ctx.strokeStyle = 'rgba(210, 222, 255, .2)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 8]);
    ctx.strokeRect(p.marginX, p.top, p.usableWidth - p.marginX * 2, p.bottom - p.top);
    ctx.restore();
  }

  function drawObject(view, p, now) {
    const alpha = Math.max(0, Math.min(1, (FADE_OUT_MS - (now - view.lastSeen)) / 120));
    const color = paletteColor(view.color, visuals.palette);

    if (visibility.points && visuals.particles && view.points?.length) {
      drawPointCloud(ctx, {...view, color}, p, .84 * alpha, visuals.glow ? 2.1 : 1.65, visuals.glow);
    }

    if (visibility.clusters && visuals.bounds) {
      const halfW = Math.max(Math.abs(view.size[0]), .08) * p.scale * .5;
      const h = Math.max(Math.abs(view.size[1]), .15) * p.scale;
      const cx = p.x(view.center[0]);
      const floorY = p.y(Math.max(0, view.center[1] - Math.abs(view.size[1]) * .5));
      const topY = floorY - h;

      ctx.save();
      ctx.strokeStyle = withAlpha(color, .88 * alpha);
      ctx.lineWidth = 1.35;
      if (visuals.glow) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
      }
      ctx.strokeRect(cx - halfW, topY, halfW * 2, h);
      drawCorners(cx - halfW, topY, halfW * 2, h, color, alpha);
      ctx.restore();

      if (visuals.labels) drawObjectLabel(view, cx - halfW, topY, color, alpha);
    }

    if (visibility.vectors) drawMotion(view, p, color, alpha);
  }

  function drawPointCloud(target, view, p, alpha, radius, glow) {
    const data = view.points;
    if (!data?.length) return;

    target.save();
    target.fillStyle = withAlpha(view.color || '#ffffff', alpha);
    if (glow) {
      target.shadowColor = view.color || '#ffffff';
      target.shadowBlur = 8;
    }

    const stride = data.length > 2400 ? 6 : 3;
    for (let i = 0; i + 1 < data.length; i += stride) {
      const x = p.x(data[i]);
      const y = p.y(data[i + 1]);
      if (x < 0 || x > p.usableWidth || y < 0 || y > height) continue;
      target.beginPath();
      target.arc(x, y, radius, 0, Math.PI * 2);
      target.fill();
    }
    target.restore();
  }

  function drawCorners(x, y, w, h, color, alpha) {
    const corner = Math.min(14, Math.max(7, Math.min(w, h) * .12));
    ctx.save();
    ctx.strokeStyle = withAlpha(color, alpha);
    ctx.lineWidth = 2.3;
    for (const [sx, sy] of [[1,1],[-1,1],[1,-1],[-1,-1]]) {
      const px = sx > 0 ? x : x + w;
      const py = sy > 0 ? y : y + h;
      line(ctx, px, py, px + sx * corner, py);
      line(ctx, px, py, px, py + sy * corner);
    }
    ctx.restore();
  }

  function drawObjectLabel(view, x, y, color, alpha) {
    const label = view.id !== undefined ? `ID ${view.id}` : view.uuid?.slice(0, 8) || 'OBJECT';
    ctx.save();
    ctx.font = '600 10px Inter, system-ui, sans-serif';
    ctx.fillStyle = withAlpha(color, .92 * alpha);
    ctx.fillText(label, x, Math.max(18, y - 8));
    ctx.restore();
  }

  function drawMotion(view, p, color, alpha) {
    const vx = view.velocity[0] || 0;
    const vy = view.velocity[1] || 0;
    const magnitude = Math.hypot(vx, vy);
    if (magnitude < .015) return;

    const x = p.x(view.centroid[0]);
    const y = p.y(view.centroid[1]);
    const length = Math.min(54, 12 + magnitude * 28);
    const nx = vx / magnitude;
    const ny = -vy / magnitude;

    ctx.save();
    ctx.strokeStyle = withAlpha(color, .62 * alpha);
    ctx.fillStyle = withAlpha(color, .62 * alpha);
    ctx.lineWidth = 1.2;
    line(ctx, x, y, x + nx * length, y + ny * length);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawZones(p) {
    if (!setupZones.length) return;
    ctx.save();
    ctx.font = '500 9px Inter, system-ui, sans-serif';
    setupZones.slice(0, 8).forEach((zone) => {
      const x = p.x(zone.position[0]);
      const y = p.bottom + 18;
      ctx.strokeStyle = 'rgba(191,166,255,.42)';
      line(ctx, x, p.bottom - 7, x, p.bottom + 7);
      ctx.fillStyle = 'rgba(191,166,255,.62)';
      ctx.fillText(zone.name, x + 5, y);
    });
    ctx.restore();
  }

  function drawHud(people) {
    ctx.save();
    ctx.fillStyle = 'rgba(232, 239, 255, .74)';
    ctx.font = '600 10px Inter, system-ui, sans-serif';
    const dims = sceneSize.slice(0, 3).map((v) => Number(v).toFixed(1)).join(' × ');
    ctx.fillText(`DIMENSIONS  ${dims} m`, 24, 30);
    ctx.fillText(`PEOPLE  ${people}`, 24, 46);

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(183, 197, 224, .44)';
    ctx.font = '500 9px Inter, system-ui, sans-serif';
    ctx.fillText(sceneName || sceneAddress || 'AUGMENTA', Math.max(24, width - rightInset - 24), 30);
    ctx.restore();
  }

  function setVisibility(next) {
    Object.assign(visibility, next);
  }

  function setVisualOptions(next) {
    Object.assign(visuals, next);
    if (!visuals.trails) trails.clearRect(0, 0, width, height);
  }

  function clearTracking() {
    objects.clear();
    trails.clearRect(0, 0, width, height);
  }

  function setRightInset(value) {
    rightInset = Math.max(0, Number(value) || 0);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  requestAnimationFrame(animate);

  return {
    renderFrame,
    renderSetup,
    clearTracking,
    clearSetup,
    setRightInset,
    setVisibility,
    setVisualOptions,
    resetCamera() { trails.clearRect(0, 0, width, height); },
    getCameraView() { return undefined; },
    setCameraView() { return false; },
    setCameraChangeHandler() {},
    isCameraUserControlled() { return false; }
  };
}

function walkSetup(container, visit) {
  if (!container) return;
  visit(container);
  for (const child of container.getChildren?.() || []) walkSetup(child, visit);
}

function safeVector(value, fallback) {
  if (!Array.isArray(value) || value.length < 3) return [...fallback];
  return value.slice(0, 3).map((v, i) => Number.isFinite(Number(v)) ? Number(v) : fallback[i]);
}

function easeVector(current, target, amount) {
  for (let i = 0; i < current.length; i++) current[i] += (target[i] - current[i]) * amount;
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function withAlpha(hex, alpha) {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

function paletteColor(color, mode) {
  if (mode === 'ice') return '#58e7ff';
  if (mode === 'mono') return '#f1f5ff';
  return color;
}
