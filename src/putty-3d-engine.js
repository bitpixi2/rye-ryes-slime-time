import * as THREE from 'three';

const DEFAULT_THEME = {
  dyePalette: ['#ff3f91', '#b03df2', '#5a16c8', '#28d8ca'],
  base: '#58148f',
  accent: '#ff4d9d',
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const damp = (current, target, sharpness, dt) => (
  current + (target - current) * (1 - Math.exp(-sharpness * dt))
);

/**
 * A persistent, two-ended 3D putty strand. Pointer coordinates are CSS pixels.
 * Endpoints are retained as normalized canvas coordinates so a resize does not
 * discard the shape a child made.
 */
export class StretchyPutty3DEngine {
  constructor(canvas, { getTheme = () => DEFAULT_THEME, isMobile = false } = {}) {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new TypeError('StretchyPutty3DEngine needs a canvas element.');
    }

    this.canvas = canvas;
    this.getTheme = typeof getTheme === 'function' ? getTheme : () => DEFAULT_THEME;
    this.isMobile = Boolean(isMobile);
    this.width = 1;
    this.height = 1;
    this.elapsed = 0;
    this.disposed = false;
    this.geometryDirty = true;
    this.geometryAccumulator = 1000;
    this.geometryInterval = this.isMobile ? 1000 / 30 : 1000 / 45;
    this.themeSignature = '';
    this.baseRadius = 0.42;
    this.restLengthNormalized = 0.68;

    this.ends = [
      new THREE.Vector2(0.16, 0.52),
      new THREE.Vector2(0.84, 0.52),
    ];
    this.endTargets = this.ends.map((point) => point.clone());
    this.grabs = new Map();
    this.pointerModes = new Map();
    this.bendOffsets = [0, 0.18, -0.13, 0.22, -0.16, 0.1, 0];
    this.bendImpulse = 0;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !this.isMobile,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, this.isMobile ? 1.2 : 1.55));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 20);
    this.camera.position.set(0, -0.58, 5.35);
    this.camera.lookAt(0, 0.04, 0);

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.tubeMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.5,
      metalness: 0,
      clearcoat: 0.28,
      clearcoatRoughness: 0.58,
      sheen: 0.4,
      sheenRoughness: 0.72,
      sheenColor: 0xffffff,
    });
    this.endMaterials = [0, 1].map(() => new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.46,
      metalness: 0,
      clearcoat: 0.34,
      clearcoatRoughness: 0.54,
      sheen: 0.44,
      sheenRoughness: 0.7,
      sheenColor: 0xffffff,
    }));

    const placeholderCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
    ], false, 'centripetal', 0.35);
    this.tube = new THREE.Mesh(
      new THREE.TubeGeometry(placeholderCurve, 8, this.baseRadius, 6, false),
      this.tubeMaterial,
    );
    this.tube.castShadow = true;
    this.tube.receiveShadow = true;
    this.group.add(this.tube);

    const bulbGeometry = new THREE.SphereGeometry(1, this.isMobile ? 16 : 22, this.isMobile ? 10 : 14);
    this.endBulbs = this.endMaterials.map((material) => {
      const bulb = new THREE.Mesh(bulbGeometry, material);
      bulb.castShadow = true;
      bulb.receiveShadow = true;
      this.group.add(bulb);
      return bulb;
    });
    this.bulbGeometry = bulbGeometry;

    this.floorMaterial = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0 });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), this.floorMaterial);
    this.floor.position.z = -0.56;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    this.scene.add(new THREE.HemisphereLight(0xfff7ff, 0x24142f, 1.7));
    this.keyLight = new THREE.DirectionalLight(0xffffff, 2.65);
    this.keyLight.position.set(-3.2, -3.6, 6.4);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(this.isMobile ? 512 : 1024, this.isMobile ? 512 : 1024);
    Object.assign(this.keyLight.shadow.camera, {
      left: -5,
      right: 5,
      top: 5,
      bottom: -5,
      near: 0.1,
      far: 15,
    });
    this.keyLight.shadow.camera.updateProjectionMatrix();
    this.keyLight.shadow.bias = -0.00025;
    this.keyLight.shadow.normalBias = 0.025;
    this.scene.add(this.keyLight);

    const rimLight = new THREE.DirectionalLight(0xbfe7ff, 1.2);
    rimLight.position.set(3.7, 2.8, 4.2);
    this.scene.add(rimLight);

    const fillLight = new THREE.PointLight(0xffb8dd, 0.9, 12);
    fillLight.position.set(-2.2, 2.2, 3.2);
    this.scene.add(fillLight);

    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();
    this.interactionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.08);
    this.worldScratch = new THREE.Vector3();
    this.palette = [];
    this.refreshTheme(true);
    this.rebuildGeometry();
  }

  get metrics() {
    const endpointsNormalized = this.ends.map((point) => ({
      x: Number(point.x.toFixed(4)),
      y: Number(point.y.toFixed(4)),
    }));
    return {
      endpoints: endpointsNormalized,
      endpointsNormalized,
      stretchRatio: Number(this.stretchRatio.toFixed(3)),
      activeGrabs: this.grabs.size,
    };
  }

  get stretchRatio() {
    return clamp(this.ends[0].distanceTo(this.ends[1]) / this.restLengthNormalized, 0.35, 2.2);
  }

  surfacePoint(amount, sideOffset = 0) {
    if (!this.currentCurve) return null;
    this.camera.updateMatrixWorld();
    const t = clamp(amount, 0, 1);
    const point = this.currentCurve.getPoint(t).project(this.camera);
    const nearby = this.currentCurve.getPoint(clamp(t + (t > 0.98 ? -0.012 : 0.012), 0, 1)).project(this.camera);
    let tangentX = (nearby.x - point.x) * (t > 0.98 ? -1 : 1);
    let tangentY = (nearby.y - point.y) * (t > 0.98 ? -1 : 1);
    const tangentLength = Math.max(0.0001, Math.hypot(tangentX, tangentY));
    tangentX /= tangentLength;
    tangentY /= tangentLength;
    return {
      x: clamp((point.x + 1) * 0.5 - tangentY * sideOffset, -0.08, 1.08),
      y: clamp((1 - point.y) * 0.5 - tangentX * sideOffset, -0.08, 1.08),
      angle: Math.atan2(-tangentY, tangentX),
    };
  }

  resize(width, height) {
    if (this.disposed) return;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();

    const left = this.normalizedToWorld(0, 0.5, new THREE.Vector3());
    const right = this.normalizedToWorld(1, 0.5, new THREE.Vector3());
    const top = this.normalizedToWorld(0.5, 0, new THREE.Vector3());
    const bottom = this.normalizedToWorld(0.5, 1, new THREE.Vector3());
    this.baseRadius = Math.min(left.distanceTo(right), top.distanceTo(bottom)) * 0.15;
    this.geometryDirty = true;
    this.geometryAccumulator = 1000;
    this.rebuildGeometry();
  }

  touch(x, y, dx = 0, dy = 0, pointerId = 0, isStart = false) {
    if (this.disposed) return -1;
    const id = pointerId ?? 0;
    let mode = this.pointerModes.get(id);

    if (isStart && !mode) {
      const usedEnds = new Set(this.grabs.values());
      const candidates = [0, 1].filter((index) => !usedEnds.has(index));
      const distanceToEnd = (index) => Math.hypot(
        (this.ends[index].x * this.width) - x,
        (this.ends[index].y * this.height) - y,
      );
      const nearestEnd = [0, 1].reduce((nearest, index) => (
        distanceToEnd(index) <= distanceToEnd(nearest) ? index : nearest
      ), 0);
      const nearestAvailableEnd = candidates.length
        ? candidates.reduce((nearest, index) => (
          distanceToEnd(index) <= distanceToEnd(nearest) ? index : nearest
        ), candidates[0])
        : -1;
      const nearestEndDistance = distanceToEnd(nearestEnd);
      const nearestAvailableDistance = nearestAvailableEnd >= 0
        ? distanceToEnd(nearestAvailableEnd)
        : Infinity;
      const endHitRadius = Math.max(this.isMobile ? 60 : 54, Math.min(this.width, this.height) * 0.17);

      if (nearestAvailableDistance <= endHitRadius) {
        mode = { type: 'grab', endIndex: nearestAvailableEnd };
        this.pointerModes.set(id, mode);
        this.grabs.set(id, nearestAvailableEnd);
      } else if (nearestEndDistance <= endHitRadius) {
        this.pointerModes.set(id, { type: 'none' });
        return -1;
      } else {
        const tubeHit = this.findTubeHit(x, y);
        if (!tubeHit || nearestAvailableEnd < 0) {
          this.pointerModes.set(id, { type: 'none' });
          return -1;
        }

        // The entire strand is a grab handle. Wait for the drag direction so
        // a middle press moving right takes the right end (and vice versa).
        mode = { type: 'pending-grab', tubeT: tubeHit.t };
        this.pointerModes.set(id, mode);
      }
    }

    // A pointer that began away from the material must stay inert until it is
    // released. This prevents a later move from unexpectedly grabbing an end.
    if (!mode || mode.type === 'none') return -1;

    if (mode.type === 'pending-grab') {
      if (Math.hypot(dx, dy) < 0.1) return 'pending-grab';
      const usedEnds = new Set(this.grabs.values());
      const candidates = [0, 1].filter((index) => !usedEnds.has(index));
      if (!candidates.length) return -1;
      const directionalEnd = Math.abs(dx) >= Math.abs(dy)
        ? (dx >= 0 ? 1 : 0)
        : (mode.tubeT >= 0.5 ? 1 : 0);
      const endIndex = candidates.includes(directionalEnd) ? directionalEnd : candidates[0];
      mode = { type: 'grab', endIndex };
      this.pointerModes.set(id, mode);
      this.grabs.set(id, endIndex);
    }

    const endIndex = mode.endIndex;

    const target = this.endTargets[endIndex];
    target.set(
      clamp(x / this.width, 0.015, 0.985),
      clamp(y / this.height, 0.025, 0.975),
    );

    const otherEnd = this.ends[1 - endIndex];
    const tangentX = target.x - otherEnd.x;
    const tangentY = target.y - otherEnd.y;
    const tangentLength = Math.max(0.0001, Math.hypot(tangentX, tangentY));
    const perpendicularX = -tangentY / tangentLength;
    const perpendicularY = tangentX / tangentLength;
    const normalizedDx = dx / this.width;
    const normalizedDy = dy / this.height;
    this.bendImpulse = clamp(
      this.bendImpulse + (normalizedDx * perpendicularX + normalizedDy * perpendicularY) * 2.4,
      -0.42,
      0.42,
    );
    this.geometryDirty = true;
    return endIndex;
  }

  release(pointerId = 0) {
    if (this.disposed) return false;
    const id = pointerId ?? 0;
    const mode = this.pointerModes.get(id);
    this.pointerModes.delete(id);
    if (!mode || mode.type === 'none') return false;

    const endIndex = mode.endIndex;
    this.grabs.delete(id);
    this.endTargets[endIndex].copy(this.ends[endIndex]);
    this.geometryDirty = true;
    return true;
  }

  update(dt = 16.6667) {
    if (this.disposed) return;
    const milliseconds = clamp(Number.isFinite(dt) ? dt : 16.6667, 0, 50);
    const seconds = milliseconds / 1000;
    this.elapsed += seconds;
    this.geometryAccumulator += milliseconds;
    this.refreshTheme();

    let moved = false;
    const grabbedEnds = new Set(this.grabs.values());
    this.ends.forEach((point, index) => {
      const target = this.endTargets[index];
      const previousX = point.x;
      const previousY = point.y;
      point.x = damp(point.x, target.x, grabbedEnds.has(index) ? 14 : 20, seconds);
      point.y = damp(point.y, target.y, grabbedEnds.has(index) ? 14 : 20, seconds);
      moved ||= Math.abs(point.x - previousX) + Math.abs(point.y - previousY) > 0.00002;
    });

    if (moved) this.geometryDirty = true;
    if (this.geometryDirty && this.geometryAccumulator >= this.geometryInterval) {
      this.geometryAccumulator %= this.geometryInterval;
      this.rebuildGeometry();
    }
    this.renderer.render(this.scene, this.camera);
  }

  refreshTheme(force = false) {
    let theme;
    try {
      theme = this.getTheme() || DEFAULT_THEME;
    } catch {
      theme = DEFAULT_THEME;
    }
    const palette = Array.isArray(theme.dyePalette) && theme.dyePalette.length
      ? theme.dyePalette
      : Array.isArray(theme.palette) && theme.palette.length
        ? theme.palette
        : DEFAULT_THEME.dyePalette;
    const signature = `${palette.join('|')}|${theme.base || ''}|${theme.accent || ''}`;
    if (!force && signature === this.themeSignature) return;

    this.themeSignature = signature;
    this.palette = palette.map((color) => new THREE.Color(color));
    const tableColor = new THREE.Color(theme.base || palette[palette.length - 1] || DEFAULT_THEME.base)
      .lerp(new THREE.Color(0x211628), 0.32);
    this.scene.background = tableColor;
    this.floorMaterial.color.copy(tableColor);
    this.tubeMaterial.sheenColor.set(theme.accent || palette[0] || DEFAULT_THEME.accent);
    this.endMaterials.forEach((material, index) => {
      material.color.copy(this.palette[index % this.palette.length]);
      material.sheenColor.set(theme.accent || palette[0] || DEFAULT_THEME.accent);
    });
    this.geometryDirty = true;
  }

  normalizedToWorld(x, y, target = new THREE.Vector3()) {
    this.pointerNdc.set(x * 2 - 1, 1 - y * 2);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    return this.raycaster.ray.intersectPlane(this.interactionPlane, target) || target.set(0, 0, 0.08);
  }

  findTubeHit(x, y) {
    if (!this.currentCurve) return null;
    this.camera.updateMatrixWorld();
    const samples = this.isMobile ? 42 : 56;
    let nearest = null;
    const projected = new THREE.Vector3();
    for (let index = 0; index <= samples; index += 1) {
      const t = index / samples;
      projected.copy(this.currentCurve.getPoint(t)).project(this.camera);
      const screenX = (projected.x + 1) * 0.5 * this.width;
      const screenY = (1 - projected.y) * 0.5 * this.height;
      const distance = Math.hypot(screenX - x, screenY - y);
      if (!nearest || distance < nearest.distance) nearest = { t, distance };
    }

    const tubeHitRadius = Math.max(
      this.isMobile ? 44 : 34,
      Math.min(this.width, this.height) * 0.17,
    );
    return nearest?.distance <= tubeHitRadius ? nearest : null;
  }

  buildCurvePoints() {
    const start = this.normalizedToWorld(this.ends[0].x, this.ends[0].y, new THREE.Vector3());
    const finish = this.normalizedToWorld(this.ends[1].x, this.ends[1].y, new THREE.Vector3());
    const tangent = finish.clone().sub(start);
    const length = Math.max(0.001, tangent.length());
    tangent.normalize();
    const perpendicular = new THREE.Vector3(-tangent.y, tangent.x, 0);
    const slack = clamp(1.18 - (this.stretchRatio - 1) * 0.6, 0.28, 1.25);
    const impulse = this.bendImpulse * this.baseRadius;

    return this.bendOffsets.map((offset, index, offsets) => {
      const amount = index / (offsets.length - 1);
      const point = start.clone().lerp(finish, amount);
      const centerWeight = Math.sin(amount * Math.PI);
      point.addScaledVector(perpendicular, (offset * this.baseRadius * slack) + impulse * centerWeight);
      point.z = 0.08 + Math.sin(amount * Math.PI) * this.baseRadius * 0.12;
      return point;
    });
  }

  applyTubeColors(geometry) {
    const positions = geometry.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);
    const radialSegments = this.isMobile ? 8 : 11;
    const tubularSegments = this.isMobile ? 34 : 52;
    const ringSize = radialSegments + 1;

    for (let index = 0; index < positions.count; index += 1) {
      const ring = Math.min(tubularSegments, Math.floor(index / ringSize));
      const amount = ring / tubularSegments;
      const scaled = amount * this.palette.length;
      const firstIndex = Math.floor(scaled) % this.palette.length;
      const secondIndex = (firstIndex + 1) % this.palette.length;
      const localAmount = scaled - Math.floor(scaled);
      const color = this.palette[firstIndex].clone().lerp(this.palette[secondIndex], localAmount);
      const around = (index % ringSize) / radialSegments;
      color.offsetHSL(0, 0.035 * Math.sin(around * Math.PI * 2), 0.055 * Math.cos(around * Math.PI * 2));
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  rebuildGeometry() {
    if (this.disposed || !this.palette.length) return;
    const points = this.buildCurvePoints();
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.35);
    this.currentCurve = curve;
    const stretch = this.stretchRatio;
    const radius = clamp(this.baseRadius / Math.sqrt(Math.max(0.55, stretch)), this.baseRadius * 0.48, this.baseRadius * 1.28);
    const tubularSegments = this.isMobile ? 34 : 52;
    const radialSegments = this.isMobile ? 8 : 11;
    const geometry = new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false);
    this.applyTubeColors(geometry);

    const oldGeometry = this.tube.geometry;
    this.tube.geometry = geometry;
    oldGeometry.dispose();

    const bulbScale = radius * 1.3;
    this.endBulbs.forEach((bulb, index) => {
      bulb.position.copy(index === 0 ? points[0] : points[points.length - 1]);
      bulb.scale.set(bulbScale * 1.08, bulbScale, bulbScale * 0.94);
      bulb.material.color.copy(this.palette[index === 0 ? 0 : Math.max(0, this.palette.length - 1)]);
    });

    this.geometryDirty = false;
    this.renderer.shadowMap.needsUpdate = true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.grabs.clear();
    this.pointerModes.clear();
    this.tube.geometry.dispose();
    this.tubeMaterial.dispose();
    this.bulbGeometry.dispose();
    this.endMaterials.forEach((material) => material.dispose());
    this.floor.geometry.dispose();
    this.floorMaterial.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
  }
}

export default StretchyPutty3DEngine;
