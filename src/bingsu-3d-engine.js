import * as THREE from 'three';

const DEFAULT_THEME = { dyePalette: ['#ff3f91', '#b03df2', '#5a16c8', '#28d8ca'], base: '#58148f', accent: '#ff4d9d' };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const damp = (current, target, sharpness, dt) => current + (target - current) * (1 - Math.exp(-sharpness * dt));

export class BingsuSlime3DEngine {
  constructor(canvas, { getTheme = () => DEFAULT_THEME, isMobile = false } = {}) {
    this.canvas = canvas;
    this.getTheme = getTheme;
    this.isMobile = Boolean(isMobile);
    this.width = 1;
    this.height = 1;
    this.aspect = 1;
    this.compression = 0;
    this.elapsed = 0;
    this.popCount = 0;
    this.reloadCycle = 0;
    this.reloadStart = null;
    this.flowX = 0;
    this.flowY = 0;
    this.flowTwist = 0;
    this.dyeTrails = [];
    this.disposed = false;
    this.dummy = new THREE.Object3D();
    this.colorScratch = new THREE.Color();
    this.surfaceCache = [];
    this.restSurfaceCache = [];
    this.projectScratch = new THREE.Vector3();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.isMobile, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, this.isMobile ? 1.15 : 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.32;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-4, 4, 3.35, -3.35, 0.1, 30);
    this.camera.position.set(0, -5.4, 8.2);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.HemisphereLight(0xfff8ff, 0x3c2850, 2.35));
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    this.keyLight = new THREE.DirectionalLight(0xffffff, 3.8);
    this.keyLight.position.set(-3.8, -4.6, 8);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(this.isMobile ? 512 : 1024, this.isMobile ? 512 : 1024);
    Object.assign(this.keyLight.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 0.1, far: 24 });
    this.scene.add(this.keyLight);
    const rim = new THREE.DirectionalLight(0x8eefff, 1.25);
    rim.position.set(4, 3, 5);
    this.scene.add(rim);

    this.floorMaterial = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), this.floorMaterial);
    this.floor.position.z = -0.42;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    this.columns = this.isMobile ? 6 : 8;
    this.rows = this.isMobile ? 7 : 5;
    this.levelCount = 5;
    this.cells = [];
    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const index = row * this.columns + column;
        this.cells.push({
          nx: (column + 0.5 + (row % 2) * 0.14) / this.columns,
          ny: (row + 0.5) / this.rows,
          tier: (column + row * 2 + index) % this.levelCount,
          phase: index * 1.731,
          compression: 0,
          targetCompression: 0,
          hitCount: 0,
          state: 'active',
          popAge: 0,
          popLift: 0,
          popVelocity: 0,
          visibleScale: 1,
          respawnAt: Infinity,
        });
      }
    }

    this.cellGeometry = new THREE.SphereGeometry(1, this.isMobile ? 12 : 16, this.isMobile ? 8 : 11);
    this.cellMaterials = Array.from({ length: 4 }, () => new THREE.MeshStandardMaterial({ roughness: 0.66, metalness: 0 }));
    this.cellMeshes = this.cells.map((cell, index) => {
      const mesh = new THREE.Mesh(this.cellGeometry, this.cellMaterials[(index + cell.tier) % this.cellMaterials.length]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      return mesh;
    });

    const beadCount = this.isMobile ? 120 : 160;
    this.beads = Array.from({ length: beadCount }, (_, index) => ({
      cellIndex: (index * 37) % this.cells.length,
      ox: Math.sin(index * 2.31) * 0.34,
      oy: Math.cos(index * 1.77) * 0.25,
      angle: index * 1.91,
      size: 0.72 + (index % 5) * 0.08,
    }));
    this.beadGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.beadMaterial = new THREE.MeshBasicMaterial({ color: 0xfff06a });
    this.beadMaterial.toneMapped = false;
    this.beadMesh = new THREE.InstancedMesh(this.beadGeometry, this.beadMaterial, this.beads.length);
    this.beadMesh.castShadow = true;
    this.scene.add(this.beadMesh);
    this.refreshTheme();
    this.updateInstances();
  }

  refreshTheme() {
    const theme = this.getTheme?.() || DEFAULT_THEME;
    this.palette = (theme.dyePalette || DEFAULT_THEME.dyePalette).map((color) => new THREE.Color(color));
    const floorColor = new THREE.Color(theme.base || DEFAULT_THEME.base).lerp(new THREE.Color(0x20162b), 0.24);
    this.scene.background = floorColor;
    this.floorMaterial.color.copy(floorColor);
    this.cellMaterials.forEach((material, index) => material.color.copy(this.palette[index % this.palette.length]));
    this.beadMaterial.color.set(theme.accent || DEFAULT_THEME.accent);
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.aspect = this.width / this.height;
    this.renderer.setSize(this.width, this.height, false);
    const halfHeight = 3.35;
    this.camera.left = -halfHeight * this.aspect;
    this.camera.right = halfHeight * this.aspect;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
    this.updateInstances();
  }

  cellWorld(cell) {
    const width = 6.7 * this.aspect;
    return { x: (cell.nx - 0.5) * width, y: (0.5 - cell.ny) * 6.7, sx: width / this.columns * 0.72, sy: 6.7 / this.rows * 0.76 };
  }

  get activeCellIndices() {
    return this.cells
      .map((cell, index) => ({ cell, index }))
      .filter(({ cell }) => cell.state === 'active')
      .map(({ index }) => index);
  }

  surfacePoint(index) {
    const cell = this.cells[index];
    const point = this.surfaceCache[index];
    if (!cell || !point) return null;
    return {
      x: point.x,
      y: point.y,
      state: cell.state,
      visibleScale: cell.visibleScale,
    };
  }

  touch(x, y, dx = 0, dy = 0, isStart = false) {
    const nx = clamp(x / this.width, 0, 1);
    const ny = clamp(y / this.height, 0, 1);
    this.flowX = clamp(this.flowX + dx * 0.7, -this.width * 0.35, this.width * 0.35);
    this.flowY = clamp(this.flowY + dy * 0.7, -this.height * 0.35, this.height * 0.35);
    this.flowTwist = clamp(this.flowTwist + (dx / this.width - dy / this.height) * 3, -1.4, 1.4);
    let compressed = 0;
    this.cells.forEach((cell, index) => {
      const surface = this.surfacePoint(index);
      if (!surface || surface.state === 'gone') return;
      const distance = Math.hypot(surface.x - nx, surface.y - ny);
      if (distance > 0.2) return;
      const influence = (1 - distance / 0.2) ** 2;
      cell.targetCompression = Math.max(cell.targetCompression, 0.98 * influence);
      compressed += influence;
    });
    this.compression = Math.max(this.compression, compressed / 5.5);
    this.dyeTrails.push({ x: nx, y: ny, createdAt: performance.now() });
    if (this.dyeTrails.length > 160) this.dyeTrails.shift();
    if (!isStart) return null;

    const target = this.cells
      .map((cell, index) => {
        const surface = this.surfacePoint(index);
        const rest = this.restSurfaceCache[index];
        const liveDistance = surface ? Math.hypot(surface.x - nx, surface.y - ny) : Infinity;
        const restDistance = rest ? Math.hypot(rest.x - nx, rest.y - ny) : Infinity;
        return { cell, index, distance: Math.min(liveDistance, restDistance) };
      })
      .filter(({ cell }) => cell.state === 'active')
      .sort((first, second) => first.distance - second.distance)[0];
    if (!target || target.distance > 0.22) return null;
    target.cell.hitCount += 1;
    target.cell.targetCompression = 1;
    if (target.cell.hitCount < 3) return { popped: false, index: target.index, hits: target.cell.hitCount };
    target.cell.state = 'popping';
    target.cell.popAge = 0;
    target.cell.popLift = 0;
    target.cell.popVelocity = 1.15;
    this.popCount += 1;
    return { popped: true, index: target.index, hits: target.cell.hitCount };
  }

  updateInstances() {
    if (this.disposed || !this.palette?.length) return;
    this.cells.forEach((cell, index) => {
      const world = this.cellWorld(cell);
      const tierLift = cell.tier * 0.16;
      const depth = cell.compression * (0.38 + cell.tier * 0.08);
      const height = (0.36 + cell.tier * 0.07) * (1 - cell.compression * 0.62);
      const mesh = this.cellMeshes[index];
      mesh.visible = cell.visibleScale > 0.008;
      mesh.position.set(world.x, world.y, 0.02 + tierLift - depth + cell.popLift);
      mesh.rotation.set(0, 0, Math.sin(cell.phase) * 0.08);
      mesh.scale.set(
        world.sx * 0.88 * (1 + cell.compression * 0.08) * cell.visibleScale,
        world.sy * 0.88 * (1 + cell.compression * 0.08) * cell.visibleScale,
        height * cell.visibleScale,
      );
    });
    this.camera.updateMatrixWorld();
    this.surfaceCache = this.cellMeshes.map((mesh) => {
      this.projectScratch.set(mesh.position.x, mesh.position.y, mesh.position.z + mesh.scale.z * 0.7).project(this.camera);
      return { x: (this.projectScratch.x + 1) * 0.5, y: (1 - this.projectScratch.y) * 0.5 };
    });
    this.surfaceCache.forEach((surface, index) => {
      const cell = this.cells[index];
      if (!this.restSurfaceCache[index] || (cell.state === 'active' && cell.hitCount === 0 && cell.compression < 0.02)) {
        this.restSurfaceCache[index] = { ...surface };
      }
    });
    this.beads.forEach((bead, index) => {
      const cell = this.cells[bead.cellIndex];
      const world = this.cellWorld(cell);
      const tierLift = cell.tier * 0.16;
      const depth = cell.compression * (0.4 + cell.tier * 0.08);
      this.dummy.position.set(world.x + bead.ox * world.sx, world.y + bead.oy * world.sy, 0.42 + tierLift - depth + cell.popLift);
      this.dummy.rotation.set(0.08, 0.16, bead.angle + this.flowTwist * 0.05);
      this.dummy.scale.set(
        world.sx * 0.17 * bead.size * cell.visibleScale,
        world.sy * 0.055 * cell.visibleScale,
        0.055 * cell.visibleScale,
      );
      this.dummy.updateMatrix();
      this.beadMesh.setMatrixAt(index, this.dummy.matrix);
    });
    this.beadMesh.instanceMatrix.needsUpdate = true;
  }

  update(dt = 16.6667) {
    if (this.disposed) return;
    const seconds = clamp(dt, 0, 50) / 1000;
    this.elapsed += seconds;
    let maximumCompression = 0;
    this.cells.forEach((cell) => {
      if (cell.state === 'popping') {
        cell.popAge += seconds;
        cell.popVelocity -= 3.8 * seconds;
        cell.popLift += cell.popVelocity * seconds;
        cell.visibleScale = cell.popAge < 0.12
          ? 1 + Math.sin(cell.popAge / 0.12 * Math.PI) * 0.28
          : clamp(1 - (cell.popAge - 0.12) / 0.34, 0, 1);
        if (cell.popAge >= 0.46) {
          cell.state = 'gone';
          cell.visibleScale = 0;
          cell.compression = 0;
          cell.targetCompression = 0;
        }
        return;
      }
      if (cell.state === 'gone') {
        if (this.elapsed >= cell.respawnAt) {
          cell.state = 'respawning';
          cell.visibleScale = 0.02;
          cell.popLift = -0.12;
          cell.hitCount = 0;
        }
        return;
      }
      if (cell.state === 'respawning') {
        cell.visibleScale = damp(cell.visibleScale, 1, 3.2, seconds);
        cell.popLift = damp(cell.popLift, 0, 4, seconds);
        if (cell.visibleScale > 0.985) {
          cell.visibleScale = 1;
          cell.state = 'active';
        }
      }
      cell.compression = damp(cell.compression, cell.targetCompression, cell.targetCompression > cell.compression ? 20 : 2.8, seconds);
      cell.targetCompression = damp(cell.targetCompression, 0, 1.7, seconds);
      maximumCompression = Math.max(maximumCompression, cell.compression);
    });
    if (this.reloadStart === null && this.cells.every((cell) => cell.state === 'gone')) {
      this.reloadStart = this.elapsed + 1.1;
      this.reloadCycle += 1;
      this.cells.forEach((cell, index) => { cell.respawnAt = this.reloadStart + index * 0.045; });
    }
    if (this.reloadStart !== null && this.cells.every((cell) => cell.state === 'active')) this.reloadStart = null;
    this.compression = damp(this.compression, maximumCompression, 8, seconds);
    this.flowX *= 0.995;
    this.flowY *= 0.995;
    this.flowTwist *= 0.994;
    this.updateInstances();
    this.renderer.render(this.scene, this.camera);
  }

  get popMetrics() {
    const count = (state) => this.cells.filter((cell) => cell.state === state).length;
    return {
      pressesPerPop: 3,
      poppedTotal: this.popCount,
      remaining: count('active') + count('respawning'),
      popping: count('popping'),
      gone: count('gone'),
      reloading: this.reloadStart !== null,
      reloadCycle: this.reloadCycle,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cellGeometry.dispose();
    this.cellMaterials.forEach((material) => material.dispose());
    this.beadGeometry.dispose();
    this.beadMaterial.dispose();
    this.floor.geometry.dispose();
    this.floorMaterial.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
  }
}
