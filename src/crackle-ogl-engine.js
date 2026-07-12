import { Box, Camera, Mesh, Program, Renderer, Sphere, Transform, Vec3 } from 'ogl';

const DEFAULT_THEME = {
  dyePalette: ['#ff297f', '#b03df2', '#5a16c8', '#28d8ca'],
  palette: ['#ff3f91', '#ff79c5', '#a74df4', '#6d24d6', '#ffd0e8'],
  base: '#58148f',
  accent: '#ff4d9d',
};

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const randomBetween = (minimum, maximum) => minimum + Math.random() * (maximum - minimum);

function colorToRgb(color, fallback = '#ffffff') {
  const normalized = String(color || fallback).replace('#', '');
  const expanded = normalized.length === 3
    ? normalized.split('').map((character) => character + character).join('')
    : normalized.padEnd(6, 'f').slice(0, 6);
  return [0, 2, 4].map((offset) => parseInt(expanded.slice(offset, offset + 2), 16) / 255);
}

function mixRgb(first, second, amount) {
  return first.map((value, index) => value + (second[index] - value) * amount);
}

const vertexShader = /* glsl */ `
  attribute vec3 position;
  attribute vec3 normal;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  uniform mat3 normalMatrix;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewPosition = viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uGloss;
  uniform float uSpecularStrength;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 lightDirection = normalize(vec3(-0.42, 0.52, 0.96));
    float diffuse = max(dot(normal, lightDirection), 0.0);
    vec3 viewDirection = normalize(-vViewPosition);
    vec3 halfDirection = normalize(lightDirection + viewDirection);
    float highlight = pow(max(dot(normal, halfDirection), 0.0), mix(16.0, 42.0, uGloss));
    float edgeShade = 0.82 + 0.18 * abs(normal.z);
    vec3 color = uColor * (0.4 + diffuse * 0.56) * edgeShade;
    color += highlight * uSpecularStrength;
    gl_FragColor = vec4(color, 1.0);
  }
`;

/**
 * A genuinely 3D wax-crackle surface built with OGL. The shell is made from
 * individually lit plates which lift, tumble, shrink, and permanently leave
 * holes when pressed, revealing the thick coloured slime below.
 */
export class OglCrackleEngine {
  constructor(canvas, { getTheme = () => DEFAULT_THEME, onCrack = () => {}, isMobile = false } = {}) {
    if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('OglCrackleEngine needs a canvas element.');
    this.canvas = canvas;
    this.getTheme = typeof getTheme === 'function' ? getTheme : () => DEFAULT_THEME;
    this.onCrack = typeof onCrack === 'function' ? onCrack : () => {};
    this.isMobile = Boolean(isMobile);
    this.width = 1;
    this.height = 1;
    this.viewWidth = 6;
    this.viewHeight = 6;
    this.elapsed = 0;
    this.fractureBursts = 0;
    this.brokenPlateCount = 0;
    this.lastBreakAt = 0;
    this.lastBreak = { x: -1, y: -1 };
    this.totalEffort = 0;
    this.pressProgress = 0;
    this.underlayerDragEvents = 0;
    this.underlayerDragDistance = 0;
    this.underlayerFlowEnergy = 0;
    this.shellSpecularStrength = 0.085;
    this.disposed = false;

    this.renderer = new Renderer({
      canvas,
      dpr: Math.min(globalThis.devicePixelRatio || 1, this.isMobile ? 1.2 : 1.55),
      antialias: !this.isMobile,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.gl = this.renderer.gl;
    this.gl.enable(this.gl.DEPTH_TEST);

    this.scene = new Transform();
    this.camera = new Camera(this.gl, { near: 0.1, far: 30, left: -3, right: 3, bottom: -3, top: 3 });
    this.camera.position.set(0, -0.35, 8);
    this.camera.lookAt(new Vec3(0, 0, 0));

    let theme;
    try { theme = this.getTheme() || DEFAULT_THEME; } catch { theme = DEFAULT_THEME; }
    this.theme = theme;
    const baseRgb = colorToRgb(theme.base, DEFAULT_THEME.base);
    this.gl.clearColor(baseRgb[0] * 0.42, baseRgb[1] * 0.42, baseRgb[2] * 0.42, 1);

    this.programs = [];
    const makeProgram = (color, gloss = 0.5, specularStrength = 0.1) => {
      const program = new Program(this.gl, {
        vertex: vertexShader,
        fragment: fragmentShader,
        uniforms: {
          uColor: { value: color },
          uGloss: { value: gloss },
          uSpecularStrength: { value: specularStrength },
        },
        cullFace: this.gl.BACK,
      });
      this.programs.push(program);
      return program;
    };

    const dyePalette = theme.dyePalette?.length ? theme.dyePalette : DEFAULT_THEME.dyePalette;
    const shellTint = colorToRgb(theme.palette?.[4] || '#ffeaf7');
    const ivory = colorToRgb('#fff9ec');
    const shellColors = [
      mixRgb(ivory, shellTint, 0.26),
      mixRgb(ivory, shellTint, 0.3),
      mixRgb(ivory, colorToRgb(theme.accent || '#ff9dd1'), 0.12),
      mixRgb(ivory, shellTint, 0.34),
    ];
    this.shellPrograms = shellColors.map((color, index) => makeProgram(
      color,
      0.52 - index * 0.025,
      this.shellSpecularStrength - index * 0.008,
    ));
    this.slimePrograms = dyePalette.map((color, index) => makeProgram(
      mixRgb(colorToRgb(color), colorToRgb(theme.base), index % 2 ? 0.08 : 0.18),
      0.34,
      0.15,
    ));

    this.boxGeometry = new Box(this.gl);
    this.sphereGeometry = new Sphere(this.gl, {
      radius: 0.5,
      widthSegments: this.isMobile ? 18 : 24,
      heightSegments: this.isMobile ? 10 : 14,
    });

    this.base = new Mesh(this.gl, { geometry: this.boxGeometry, program: this.slimePrograms[2 % this.slimePrograms.length] });
    this.base.position.z = -0.62;
    this.base.setParent(this.scene);

    const underlayerPositions = [
      [0.16, 0.18], [0.48, 0.14], [0.82, 0.19],
      [0.1, 0.5], [0.35, 0.46], [0.63, 0.54], [0.9, 0.48],
      [0.2, 0.82], [0.51, 0.84], [0.82, 0.79],
    ];
    this.slimeBlobs = underlayerPositions.map(([nx, ny], index) => {
      const mesh = new Mesh(this.gl, {
        geometry: this.sphereGeometry,
        program: this.slimePrograms[index % this.slimePrograms.length],
      });
      mesh.setParent(this.scene);
      return {
        mesh,
        index,
        nx,
        ny,
        homeNx: nx,
        homeNy: ny,
        vx: 0,
        vy: 0,
        compression: 0,
        phase: index * 1.37,
        baseScaleX: 1,
        baseScaleY: 1,
        baseScaleZ: 0.44 + (index % 3) * 0.018,
      };
    });

    this.columns = this.isMobile ? 10 : 12;
    this.rows = 10;
    this.plates = Array.from({ length: this.columns * this.rows }, (_, index) => {
      const column = index % this.columns;
      const row = Math.floor(index / this.columns);
      const mesh = new Mesh(this.gl, {
        geometry: this.boxGeometry,
        program: this.shellPrograms[(column + row * 2) % this.shellPrograms.length],
      });
      mesh.rotation.z = Math.sin(index * 2.17) * 0.018;
      mesh.setParent(this.scene);
      return {
        mesh,
        index,
        column,
        row,
        nx: (column + 0.5) / this.columns,
        ny: (row + 0.5) / this.rows,
        broken: false,
        damage: 0,
        threshold: randomBetween(0.94, 1.24),
        baseZ: 0.28 + Math.sin(index * 1.71) * 0.012,
        age: 0,
        velocity: new Vec3(),
        rotationVelocity: new Vec3(),
      };
    });

    this.resize(1, 1);
  }

  layoutSlimeBlob(blob) {
    const speed = Math.hypot(blob.vx, blob.vy);
    const stretchX = 1 + Math.min(0.18, Math.abs(blob.vx) * 1.5) + blob.compression * 0.07;
    const stretchY = 1 + Math.min(0.18, Math.abs(blob.vy) * 1.5) + blob.compression * 0.07;
    blob.mesh.position.x = (blob.nx - 0.5) * this.viewWidth;
    blob.mesh.position.y = (0.5 - blob.ny) * this.viewHeight;
    blob.mesh.position.z = -0.105 - blob.compression * 0.025 + Math.sin(this.elapsed * 0.68 + blob.phase) * 0.012;
    blob.mesh.scale.set(
      blob.baseScaleX * stretchX,
      blob.baseScaleY * stretchY,
      blob.baseScaleZ * (1 - blob.compression * 0.26),
    );
    blob.mesh.rotation.z = Math.sin(this.elapsed * 0.2 + blob.phase) * 0.018
      + Math.atan2(blob.vy, blob.vx || 0.0001) * Math.min(0.035, speed * 0.16);
  }

  flowSlime(x, y, dx = 0, dy = 0) {
    const nx = clamp(x / this.width, 0, 1);
    const ny = clamp(y / this.height, 0, 1);
    const ndx = clamp(dx / this.width, -0.035, 0.035);
    const ndy = clamp(dy / this.height, -0.035, 0.035);
    const dragDistance = Math.hypot(ndx, ndy);
    const radius = 0.34;
    const nearby = this.slimeBlobs
      .map((blob) => ({ blob, distance: Math.hypot(blob.nx - nx, blob.ny - ny) }))
      .sort((first, second) => first.distance - second.distance);

    nearby.forEach(({ blob, distance }, index) => {
      if (distance > radius && index > 1) return;
      const influence = distance < radius ? (1 - distance / radius) ** 2 : 0.08;
      const offsetX = blob.nx - nx;
      const offsetY = blob.ny - ny;
      blob.vx += (ndx * 1.45 - offsetY * dragDistance * 0.18) * influence;
      blob.vy += (ndy * 1.45 + offsetX * dragDistance * 0.18) * influence;
      blob.compression = Math.max(blob.compression, clamp(0.22 + dragDistance * 32, 0.22, 0.8) * influence);
    });

    if (dragDistance > 0.0002) {
      this.underlayerDragEvents += 1;
      this.underlayerDragDistance += dragDistance;
      this.underlayerFlowEnergy = clamp(this.underlayerFlowEnergy + dragDistance * 9, 0, 1.5);
    }
  }

  compressUnderlayer(x, y, effortSeconds, motion) {
    const nx = clamp(x / this.width, 0, 1);
    const ny = clamp(y / this.height, 0, 1);
    const pressure = clamp(effortSeconds * 8 + motion * 0.006, 0.03, 0.38);
    this.slimeBlobs
      .map((blob) => ({ blob, distance: Math.hypot(blob.nx - nx, blob.ny - ny) }))
      .sort((first, second) => first.distance - second.distance)
      .slice(0, 3)
      .forEach(({ blob }, index) => {
        blob.compression = clamp(blob.compression + pressure * (1 - index * 0.24), 0, 1);
      });
    this.underlayerFlowEnergy = Math.max(this.underlayerFlowEnergy, pressure);
  }

  get underlayerMetrics() {
    const displacements = this.slimeBlobs.map((blob) => Math.hypot(blob.nx - blob.homeNx, blob.ny - blob.homeNy));
    const center = this.slimeBlobs.reduce((sum, blob) => ({ x: sum.x + blob.nx, y: sum.y + blob.ny }), { x: 0, y: 0 });
    center.x /= this.slimeBlobs.length;
    center.y /= this.slimeBlobs.length;
    return {
      dragEvents: this.underlayerDragEvents,
      dragDistance: Number(this.underlayerDragDistance.toFixed(3)),
      flowEnergy: Number(this.underlayerFlowEnergy.toFixed(3)),
      averageDisplacement: Number((displacements.reduce((sum, value) => sum + value, 0) / displacements.length).toFixed(3)),
      maxDisplacement: Number(Math.max(...displacements).toFixed(3)),
      center: { x: Number(center.x.toFixed(3)), y: Number(center.y.toFixed(3)) },
    };
  }

  resize(width, height) {
    if (this.disposed) return;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height);
    const aspect = this.width / this.height;
    this.viewHeight = 6.2;
    this.viewWidth = this.viewHeight * aspect;
    this.camera.orthographic({
      left: -this.viewWidth / 2,
      right: this.viewWidth / 2,
      bottom: -this.viewHeight / 2,
      top: this.viewHeight / 2,
      near: 0.1,
      far: 30,
    });

    this.base.scale.set(this.viewWidth * 1.08, this.viewHeight * 1.08, 0.72);
    const cellWidth = this.viewWidth / this.columns;
    const cellHeight = this.viewHeight / this.rows;
    this.plates.forEach((plate) => {
      if (!plate.broken) {
        plate.mesh.position.x = (plate.nx - 0.5) * this.viewWidth;
        plate.mesh.position.y = (0.5 - plate.ny) * this.viewHeight;
        plate.mesh.position.z = plate.baseZ - plate.damage * 0.055;
      }
      plate.mesh.scale.set(cellWidth * 1.018, cellHeight * 1.018, 0.105);
    });

    this.slimeBlobs.forEach((blob) => {
      blob.baseScaleX = this.viewWidth * (0.28 + (blob.index % 3) * 0.025);
      blob.baseScaleY = this.viewHeight * (0.23 + (blob.index % 2) * 0.025);
      this.layoutSlimeBlob(blob);
    });
  }

  touch(x, y, dx = 0, dy = 0) {
    if (this.disposed) return;
    this.flowSlime(x, y, dx, dy);
  }

  press(x, y, effortMilliseconds = 16.6667, motion = 0) {
    if (this.disposed) return false;
    const nx = clamp(x / this.width, 0, 1);
    const ny = clamp(y / this.height, 0, 1);
    const now = performance.now();
    const candidates = this.plates
      .filter((plate) => !plate.broken)
      .map((plate) => ({ plate, distance: Math.hypot(plate.nx - nx, plate.ny - ny) }))
      .sort((a, b) => a.distance - b.distance);
    if (!candidates.length) return false;
    const effortSeconds = clamp(effortMilliseconds, 0, 80) / 1000;
    this.compressUnderlayer(x, y, effortSeconds, motion);
    const effortRate = 0.58 + Math.min(0.46, motion * 0.018);
    const focus = candidates.slice(0, 3);
    const weights = [1, 0.34, 0.14];
    focus.forEach(({ plate }, index) => {
      plate.damage = clamp(plate.damage + effortSeconds * effortRate * weights[index], 0, plate.threshold);
      const damageRatio = plate.damage / plate.threshold;
      plate.mesh.position.z = plate.baseZ - damageRatio * 0.06;
      plate.mesh.rotation.x = Math.sin(plate.index * 1.91) * damageRatio * 0.065;
      plate.mesh.rotation.y = Math.cos(plate.index * 1.37) * damageRatio * 0.065;
    });
    this.totalEffort += effortSeconds;
    this.pressProgress = focus.reduce((maximum, { plate }) => Math.max(maximum, plate.damage / plate.threshold), 0);

    const ready = focus.find(({ plate }) => plate.damage >= plate.threshold);
    if (!ready || now - this.lastBreakAt < 380) return false;
    const first = this.fractureBursts === 0;
    this.breakPlate(ready.plate, nx, ny, motion, 0);
    this.fractureBursts += 1;
    this.brokenPlateCount += 1;
    this.lastBreakAt = now;
    this.lastBreak = { x: nx, y: ny };
    this.pressProgress = 0;
    this.onCrack({
      first,
      intensity: clamp((first ? 0.78 : 0.52) + motion * 0.01, 0.48, 1.02),
      brokenCount: 1,
      shellIntegrity: this.shellIntegrity,
    });
    return true;
  }

  breakPlate(plate, touchX, touchY, speed, selectionIndex) {
    plate.broken = true;
    plate.age = 0;
    const directionX = plate.nx - touchX;
    const directionY = touchY - plate.ny;
    const length = Math.max(0.01, Math.hypot(directionX, directionY));
    const force = 0.08 + Math.min(0.18, speed * 0.006) + selectionIndex * 0.01;
    plate.velocity.set(
      directionX / length * force + randomBetween(-0.035, 0.035),
      directionY / length * force + randomBetween(-0.035, 0.035),
      randomBetween(0.25, 0.48) + Math.min(0.18, speed * 0.006),
    );
    plate.rotationVelocity.set(
      randomBetween(-0.95, 0.95),
      randomBetween(-0.95, 0.95),
      randomBetween(-0.5, 0.5),
    );
  }

  update(dt = 16.6667) {
    if (this.disposed) return;
    const seconds = clamp(Number.isFinite(dt) ? dt : 16.6667, 0, 50) / 1000;
    this.elapsed += seconds;

    this.underlayerFlowEnergy *= Math.exp(-2.4 * seconds);
    this.slimeBlobs.forEach((blob) => {
      blob.vx += (blob.homeNx - blob.nx) * 0.18 * seconds;
      blob.vy += (blob.homeNy - blob.ny) * 0.18 * seconds;
      const damping = Math.exp(-3.6 * seconds);
      blob.vx *= damping;
      blob.vy *= damping;
      blob.nx += blob.vx * seconds;
      blob.ny += blob.vy * seconds;
      if (blob.nx < 0.045 || blob.nx > 0.955) {
        blob.nx = clamp(blob.nx, 0.045, 0.955);
        blob.vx *= -0.28;
      }
      if (blob.ny < 0.045 || blob.ny > 0.955) {
        blob.ny = clamp(blob.ny, 0.045, 0.955);
        blob.vy *= -0.28;
      }
      blob.compression *= Math.exp(-2.8 * seconds);
      this.layoutSlimeBlob(blob);
    });

    this.plates.forEach((plate) => {
      if (!plate.broken || !plate.mesh.visible) return;
      plate.age += seconds;
      plate.velocity.z -= 0.82 * seconds;
      plate.mesh.position.x += plate.velocity.x * seconds;
      plate.mesh.position.y += plate.velocity.y * seconds;
      plate.mesh.position.z += plate.velocity.z * seconds;
      plate.mesh.rotation.x += plate.rotationVelocity.x * seconds;
      plate.mesh.rotation.y += plate.rotationVelocity.y * seconds;
      plate.mesh.rotation.z += plate.rotationVelocity.z * seconds;
      const shrink = Math.max(0.12, 1 - plate.age * 0.16);
      plate.mesh.scale.z = 0.105 * shrink;
      plate.mesh.scale.x *= Math.max(0.97, 1 - seconds * 0.09);
      plate.mesh.scale.y *= Math.max(0.97, 1 - seconds * 0.09);
      if (plate.age > 3.4 || plate.mesh.position.z < -1.35) plate.mesh.visible = false;
    });

    this.renderer.render({ scene: this.scene, camera: this.camera });
  }

  get shellIntegrity() {
    return Number(clamp(1 - this.brokenPlateCount / this.plates.length, 0, 1).toFixed(2));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.boxGeometry.remove();
    this.sphereGeometry.remove();
    this.programs.forEach((program) => program.remove());
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

export default OglCrackleEngine;
