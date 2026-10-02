/*
MIT License

This module contains a compact WebGL fluid solver adapted from the techniques
used by Pavel Dobryakov's WebGL Fluid Simulation:
https://github.com/PavelDoGreat/WebGL-Fluid-Simulation

Copyright (c) 2017 Pavel Dobryakov
Copyright (c) 2026 Augmenta

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

const SIM_RESOLUTION = 112;
const DYE_RESOLUTION = 448;
const PRESSURE_ITERATIONS = 12;
const PRESSURE_DISSIPATION = 0.82;
const VELOCITY_DISSIPATION = 0.34;
const DYE_DISSIPATION = 0.82;
const CURL_STRENGTH = 22;
const MAX_DT = 1 / 60;
const MAX_SPLATS_PER_FRAME = 96;
const MAX_DISPLAY_EDGE_PX = 1280;

export function createFluidField() {
  const canvas = document.createElement('canvas');
  const state = createState(canvas);

  if (!state) {
    return {
      canvas,
      supported: false,
      clear() {},
      update() {}
    };
  }

  const {
    gl,
    formatRGBA,
    formatRG,
    formatR,
    textureType,
    linearFiltering
  } = state;

  const quad = createFullscreenQuad(gl);
  const programs = createPrograms(gl);
  let buffers;
  let displayWidth = 1;
  let displayHeight = 1;
  let aspectRatio = 1;

  function clear() {
    if (!buffers) return;
    for (const target of allTargets(buffers)) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.width, target.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function resize(width, height, pixelRatio) {
    const sourceWidth = Math.max(1, Math.round(width * pixelRatio));
    const sourceHeight = Math.max(1, Math.round(height * pixelRatio));
    const scale = Math.min(1, MAX_DISPLAY_EDGE_PX / Math.max(sourceWidth, sourceHeight));
    const nextWidth = Math.max(1, Math.round(sourceWidth * scale));
    const nextHeight = Math.max(1, Math.round(sourceHeight * scale));

    if (canvas.width === nextWidth && canvas.height === nextHeight && buffers) return;

    canvas.width = nextWidth;
    canvas.height = nextHeight;
    displayWidth = nextWidth;
    displayHeight = nextHeight;
    aspectRatio = nextWidth / Math.max(nextHeight, 1);

    destroyBuffers(gl, buffers);

    const sim = resolutionForAspect(SIM_RESOLUTION, aspectRatio);
    const dye = resolutionForAspect(DYE_RESOLUTION, aspectRatio);
    const filtering = linearFiltering ? gl.LINEAR : gl.NEAREST;

    buffers = {
      velocity: createDoubleFBO(gl, sim.width, sim.height, formatRG, textureType, filtering),
      dye: createDoubleFBO(gl, dye.width, dye.height, formatRGBA, textureType, filtering),
      divergence: createFBO(gl, sim.width, sim.height, formatR, textureType, gl.NEAREST),
      curl: createFBO(gl, sim.width, sim.height, formatR, textureType, gl.NEAREST),
      pressure: createDoubleFBO(gl, sim.width, sim.height, formatR, textureType, gl.NEAREST)
    };

    clear();
  }

  function update(width, height, pixelRatio, dt, splats, options = {}) {
    resize(width, height, pixelRatio);
    if (!buffers) return;

    const stepDt = Math.min(Math.max(Number(dt) || 0, 0), MAX_DT);
    applySplats(splats?.slice(0, MAX_SPLATS_PER_FRAME) || []);
    simulate(stepDt);
    render(Boolean(options.glow));
  }

  function applySplats(splats) {
    if (!splats.length) return;

    gl.disable(gl.BLEND);

    for (const splat of splats) {
      const x = clamp01(splat.x);
      const y = clamp01(splat.y);
      const radius = Math.max(Number(splat.radius) || 0.0001, 0.00001);
      const dx = clamp(Number(splat.dx) || 0, -2000, 2000);
      const dy = clamp(Number(splat.dy) || 0, -2000, 2000);
      const color = normalizeColor(splat.color);
      const amount = clamp(Number(splat.amount) || 1, 0, 3);

      programs.splat.use();
      gl.uniform1f(programs.splat.uniforms.aspectRatio, aspectRatio);
      gl.uniform2f(programs.splat.uniforms.point, x, y);
      gl.uniform1f(programs.splat.uniforms.radius, radius);

      gl.uniform1i(programs.splat.uniforms.uTarget, buffers.velocity.read.attach(0));
      gl.uniform3f(programs.splat.uniforms.color, dx, dy, 0);
      quad.blit(buffers.velocity.write);
      buffers.velocity.swap();

      gl.uniform1i(programs.splat.uniforms.uTarget, buffers.dye.read.attach(0));
      gl.uniform3f(
        programs.splat.uniforms.color,
        color[0] * amount,
        color[1] * amount,
        color[2] * amount
      );
      quad.blit(buffers.dye.write);
      buffers.dye.swap();
    }
  }

  function simulate(dt) {
    const { velocity, dye, divergence, curl, pressure } = buffers;

    gl.disable(gl.BLEND);

    programs.curl.use();
    gl.uniform2f(programs.curl.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(programs.curl.uniforms.uVelocity, velocity.read.attach(0));
    quad.blit(curl);

    programs.vorticity.use();
    gl.uniform2f(
      programs.vorticity.uniforms.texelSize,
      velocity.texelSizeX,
      velocity.texelSizeY
    );
    gl.uniform1i(programs.vorticity.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(programs.vorticity.uniforms.uCurl, curl.attach(1));
    gl.uniform1f(programs.vorticity.uniforms.curl, CURL_STRENGTH);
    gl.uniform1f(programs.vorticity.uniforms.dt, dt);
    quad.blit(velocity.write);
    velocity.swap();

    programs.divergence.use();
    gl.uniform2f(
      programs.divergence.uniforms.texelSize,
      velocity.texelSizeX,
      velocity.texelSizeY
    );
    gl.uniform1i(programs.divergence.uniforms.uVelocity, velocity.read.attach(0));
    quad.blit(divergence);

    programs.clear.use();
    gl.uniform1i(programs.clear.uniforms.uTexture, pressure.read.attach(0));
    gl.uniform1f(programs.clear.uniforms.value, PRESSURE_DISSIPATION);
    quad.blit(pressure.write);
    pressure.swap();

    programs.pressure.use();
    gl.uniform2f(
      programs.pressure.uniforms.texelSize,
      pressure.texelSizeX,
      pressure.texelSizeY
    );
    gl.uniform1i(programs.pressure.uniforms.uDivergence, divergence.attach(0));
    for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(programs.pressure.uniforms.uPressure, pressure.read.attach(1));
      quad.blit(pressure.write);
      pressure.swap();
    }

    programs.gradient.use();
    gl.uniform2f(
      programs.gradient.uniforms.texelSize,
      velocity.texelSizeX,
      velocity.texelSizeY
    );
    gl.uniform1i(programs.gradient.uniforms.uPressure, pressure.read.attach(0));
    gl.uniform1i(programs.gradient.uniforms.uVelocity, velocity.read.attach(1));
    quad.blit(velocity.write);
    velocity.swap();

    programs.advection.use();
    gl.uniform2f(
      programs.advection.uniforms.texelSize,
      velocity.texelSizeX,
      velocity.texelSizeY
    );
    gl.uniform2f(
      programs.advection.uniforms.sourceTexelSize,
      velocity.texelSizeX,
      velocity.texelSizeY
    );
    gl.uniform1i(programs.advection.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(programs.advection.uniforms.uSource, velocity.read.attach(1));
    gl.uniform1f(programs.advection.uniforms.dt, dt);
    gl.uniform1f(programs.advection.uniforms.dissipation, VELOCITY_DISSIPATION);
    quad.blit(velocity.write);
    velocity.swap();

    gl.uniform2f(
      programs.advection.uniforms.sourceTexelSize,
      dye.texelSizeX,
      dye.texelSizeY
    );
    gl.uniform1i(programs.advection.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(programs.advection.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(programs.advection.uniforms.dissipation, DYE_DISSIPATION);
    quad.blit(dye.write);
    dye.swap();
  }

  function render(glow) {
    gl.viewport(0, 0, displayWidth, displayHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    programs.display.use();
    gl.uniform1i(programs.display.uniforms.uTexture, buffers.dye.read.attach(0));
    gl.uniform2f(
      programs.display.uniforms.texelSize,
      buffers.dye.texelSizeX,
      buffers.dye.texelSizeY
    );
    gl.uniform1f(programs.display.uniforms.glow, glow ? 1 : 0);
    quad.blit(null);
  }

  return {
    canvas,
    supported: true,
    clear,
    update
  };
}

function createState(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    depth: false,
    stencil: false,
    antialias: false,
    preserveDrawingBuffer: false,
    premultipliedAlpha: false
  });

  if (!gl) return undefined;

  gl.getExtension('EXT_color_buffer_float');
  const linearFiltering = Boolean(gl.getExtension('OES_texture_float_linear'));
  const textureType = gl.HALF_FLOAT;

  const formatRGBA = supportedFormat(gl, gl.RGBA16F, gl.RGBA, textureType);
  const formatRG = supportedFormat(gl, gl.RG16F, gl.RG, textureType)
    || supportedFormat(gl, gl.RGBA16F, gl.RGBA, textureType);
  const formatR = supportedFormat(gl, gl.R16F, gl.RED, textureType)
    || supportedFormat(gl, gl.RG16F, gl.RG, textureType)
    || supportedFormat(gl, gl.RGBA16F, gl.RGBA, textureType);

  if (!formatRGBA || !formatRG || !formatR) return undefined;

  return {
    gl,
    formatRGBA,
    formatRG,
    formatR,
    textureType,
    linearFiltering
  };
}

function supportedFormat(gl, internalFormat, format, type) {
  const texture = gl.createTexture();
  const fbo = gl.createFramebuffer();

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);

  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0
  );

  const supported = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;

  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(texture);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return supported ? { internalFormat, format } : undefined;
}

function createPrograms(gl) {
  return {
    clear: createProgram(gl, BASE_VERTEX, CLEAR_FRAGMENT),
    splat: createProgram(gl, BASE_VERTEX, SPLAT_FRAGMENT),
    advection: createProgram(gl, BASE_VERTEX, ADVECTION_FRAGMENT),
    divergence: createProgram(gl, BASE_VERTEX, DIVERGENCE_FRAGMENT),
    curl: createProgram(gl, BASE_VERTEX, CURL_FRAGMENT),
    vorticity: createProgram(gl, BASE_VERTEX, VORTICITY_FRAGMENT),
    pressure: createProgram(gl, BASE_VERTEX, PRESSURE_FRAGMENT),
    gradient: createProgram(gl, BASE_VERTEX, GRADIENT_FRAGMENT),
    display: createProgram(gl, BASE_VERTEX, DISPLAY_FRAGMENT)
  };
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, 'aPosition');
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || 'Unknown program link error';
    gl.deleteProgram(program);
    throw new Error(info);
  }

  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const name = gl.getActiveUniform(program, i).name;
    uniforms[name] = gl.getUniformLocation(program, name);
  }

  return {
    uniforms,
    use() {
      gl.useProgram(program);
    }
  };
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || 'Unknown shader compile error';
    gl.deleteShader(shader);
    throw new Error(info);
  }

  return shader;
}

function createFullscreenQuad(gl) {
  const vertexBuffer = gl.createBuffer();
  const indexBuffer = gl.createBuffer();

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]),
    gl.STATIC_DRAW
  );

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(
    gl.ELEMENT_ARRAY_BUFFER,
    new Uint16Array([0, 1, 2, 0, 2, 3]),
    gl.STATIC_DRAW
  );

  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);

  return {
    blit(target) {
      if (target) {
        gl.viewport(0, 0, target.width, target.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
  };
}

function createFBO(gl, width, height, textureFormat, type, filtering) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filtering);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filtering);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    textureFormat.internalFormat,
    width,
    height,
    0,
    textureFormat.format,
    type,
    null
  );

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0
  );

  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  return {
    texture,
    fbo,
    width,
    height,
    texelSizeX: 1 / width,
    texelSizeY: 1 / height,
    attach(unit) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      return unit;
    }
  };
}

function createDoubleFBO(gl, width, height, textureFormat, type, filtering) {
  let read = createFBO(gl, width, height, textureFormat, type, filtering);
  let write = createFBO(gl, width, height, textureFormat, type, filtering);

  return {
    width,
    height,
    texelSizeX: 1 / width,
    texelSizeY: 1 / height,
    get read() {
      return read;
    },
    get write() {
      return write;
    },
    swap() {
      [read, write] = [write, read];
    },
    destroy() {
      destroyFBO(gl, read);
      destroyFBO(gl, write);
    }
  };
}

function destroyBuffers(gl, buffers) {
  if (!buffers) return;

  buffers.velocity.destroy();
  buffers.dye.destroy();
  buffers.pressure.destroy();
  destroyFBO(gl, buffers.divergence);
  destroyFBO(gl, buffers.curl);
}

function destroyFBO(gl, target) {
  if (!target) return;
  gl.deleteFramebuffer(target.fbo);
  gl.deleteTexture(target.texture);
}

function allTargets(buffers) {
  return [
    buffers.velocity.read,
    buffers.velocity.write,
    buffers.dye.read,
    buffers.dye.write,
    buffers.divergence,
    buffers.curl,
    buffers.pressure.read,
    buffers.pressure.write
  ];
}

function resolutionForAspect(base, aspect) {
  if (aspect >= 1) {
    return {
      width: Math.max(2, Math.round(base * aspect)),
      height: base
    };
  }

  return {
    width: base,
    height: Math.max(2, Math.round(base / Math.max(aspect, 0.001)))
  };
}

function normalizeColor(color) {
  if (!Array.isArray(color)) return [1, 1, 1];
  return [0, 1, 2].map((index) => clamp(Number(color[index]) || 0, 0, 1));
}

function clamp01(value) {
  return clamp(Number(value) || 0, 0, 1);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const BASE_VERTEX = `
precision highp float;

attribute vec2 aPosition;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform vec2 texelSize;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const CLEAR_FRAGMENT = `
precision mediump float;
varying highp vec2 vUv;
uniform sampler2D uTexture;
uniform float value;

void main() {
  gl_FragColor = texture2D(uTexture, vUv) * value;
}
`;

const SPLAT_FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform float radius;

void main() {
  vec2 p = vUv - point;
  p.x *= aspectRatio;
  vec3 base = texture2D(uTarget, vUv).xyz;
  vec3 splat = exp(-dot(p, p) / radius) * color;
  gl_FragColor = vec4(base + splat, 1.0);
}
`;

const ADVECTION_FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform vec2 sourceTexelSize;
uniform float dt;
uniform float dissipation;

vec4 bilerp(sampler2D source, vec2 uv, vec2 size) {
  vec2 st = uv / size - 0.5;
  vec2 iuv = floor(st);
  vec2 fuv = fract(st);
  vec4 a = texture2D(source, (iuv + vec2(0.5, 0.5)) * size);
  vec4 b = texture2D(source, (iuv + vec2(1.5, 0.5)) * size);
  vec4 c = texture2D(source, (iuv + vec2(0.5, 1.5)) * size);
  vec4 d = texture2D(source, (iuv + vec2(1.5, 1.5)) * size);
  return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
}

void main() {
  vec2 velocity = texture2D(uVelocity, vUv).xy;
  vec2 coord = vUv - dt * velocity * texelSize;
  vec4 value = bilerp(uSource, coord, sourceTexelSize);
  gl_FragColor = value / (1.0 + dissipation * dt);
}
`;

const DIVERGENCE_FRAGMENT = `
precision mediump float;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uVelocity;

void main() {
  float L = texture2D(uVelocity, vL).x;
  float R = texture2D(uVelocity, vR).x;
  float T = texture2D(uVelocity, vT).y;
  float B = texture2D(uVelocity, vB).y;
  vec2 C = texture2D(uVelocity, vUv).xy;

  if (vL.x < 0.0) L = -C.x;
  if (vR.x > 1.0) R = -C.x;
  if (vT.y > 1.0) T = -C.y;
  if (vB.y < 0.0) B = -C.y;

  gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}
`;

const CURL_FRAGMENT = `
precision mediump float;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uVelocity;

void main() {
  float L = texture2D(uVelocity, vL).y;
  float R = texture2D(uVelocity, vR).y;
  float T = texture2D(uVelocity, vT).x;
  float B = texture2D(uVelocity, vB).x;
  gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}
`;

const VORTICITY_FRAGMENT = `
precision highp float;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;

void main() {
  float L = texture2D(uCurl, vL).x;
  float R = texture2D(uCurl, vR).x;
  float T = texture2D(uCurl, vT).x;
  float B = texture2D(uCurl, vB).x;
  float C = texture2D(uCurl, vUv).x;

  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= curl * C;
  force.y *= -1.0;

  vec2 velocity = texture2D(uVelocity, vUv).xy + force * dt;
  gl_FragColor = vec4(clamp(velocity, -1000.0, 1000.0), 0.0, 1.0);
}
`;

const PRESSURE_FRAGMENT = `
precision mediump float;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;

void main() {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  float divergence = texture2D(uDivergence, vUv).x;
  gl_FragColor = vec4((L + R + B + T - divergence) * 0.25, 0.0, 0.0, 1.0);
}
`;

const GRADIENT_FRAGMENT = `
precision mediump float;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;

void main() {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  vec2 velocity = texture2D(uVelocity, vUv).xy;
  velocity -= vec2(R - L, T - B);
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}
`;

const DISPLAY_FRAGMENT = `
precision highp float;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uTexture;
uniform vec2 texelSize;
uniform float glow;

void main() {
  vec3 c = texture2D(uTexture, vUv).rgb;

  vec3 neighbor =
    texture2D(uTexture, vL).rgb +
    texture2D(uTexture, vR).rgb +
    texture2D(uTexture, vT).rgb +
    texture2D(uTexture, vB).rgb;
  neighbor *= 0.25;

  c += neighbor * 0.34 * glow;

  vec3 left = texture2D(uTexture, vL).rgb;
  vec3 right = texture2D(uTexture, vR).rgb;
  vec3 top = texture2D(uTexture, vT).rgb;
  vec3 bottom = texture2D(uTexture, vB).rgb;
  float dx = length(right) - length(left);
  float dy = length(top) - length(bottom);
  vec3 normal = normalize(vec3(dx, dy, max(length(texelSize), 0.0001)));
  float shading = clamp(dot(normal, vec3(0.0, 0.0, 1.0)) + 0.78, 0.78, 1.08);
  c *= shading;

  c = c / (1.0 + c);
  c = pow(max(c, 0.0), vec3(0.72));

  float alpha = clamp(max(c.r, max(c.g, c.b)) * 0.82, 0.0, 0.86);
  gl_FragColor = vec4(c, alpha);
}
`;
