import {
  ACESFilmicToneMapping,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from "three";

export interface BondScene {
  draw(
    progress: number,
    time: number,
    pointer: { x: number; y: number },
    momentum: number,
  ): { left: number[]; right: number[]; center: number[] };
  resize(): void;
  destroy(): void;
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => {
  n = clamp(n);
  return n * n * (3 - 2 * n);
};

export function createBondScene(
  canvas: HTMLCanvasElement,
  host: HTMLElement,
): BondScene {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const scene = new Scene();
  const studio = new Scene();
  studio.background = new Color(0x202630);
  const studioGeometry = new PlaneGeometry(1, 1);
  const studioMaterials: MeshBasicMaterial[] = [];
  // Broad studio strips and dark flags keep the metal in the hero's silver/graphite range.
  const panels = [
    { p: [-5, 2, 6], s: [3, 11], power: 4 },
    { p: [3, 4, 5], s: [5, 10], power: 2.7 },
    { p: [0, 8, 0], s: [14, 5], power: 5 },
    { p: [7, 0, -2], s: [3, 8], power: 3 },
    { p: [-3, -5, 4], s: [10, 1.7], power: 2 },
    { p: [1, -1, 7], s: [1.1, 9], power: 0.025 },
  ];
  for (const panel of panels) {
    const material = new MeshBasicMaterial({
      color: new Color().setRGB(panel.power, panel.power, panel.power),
      side: DoubleSide,
    });
    studioMaterials.push(material);
    const card = new Mesh(studioGeometry, material);
    card.position.set(panel.p[0], panel.p[1], panel.p[2]);
    card.scale.set(panel.s[0], panel.s[1], 1);
    card.lookAt(0, 0, 0);
    studio.add(card);
  }
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(studio, 0.035);
  scene.environment = environment.texture;
  scene.environmentIntensity = 1.05;
  studioGeometry.dispose();
  studioMaterials.forEach((m) => m.dispose());
  pmrem.dispose();
  const camera = new PerspectiveCamera(30, 1, 0.1, 100);
  const sculpture = new Group();
  scene.add(sculpture);

  const silver = new MeshStandardMaterial({
    color: 0xc6ccd1,
    metalness: 1,
    roughness: 0.18,
  });
  const rodMaterial = new MeshStandardMaterial({
    color: 0xb6bec6,
    metalness: 1,
    roughness: 0.2,
  });
  const signalMaterial = new MeshStandardMaterial({
    color: 0x416bd7,
    metalness: 0.45,
    roughness: 0.2,
    emissive: 0x315cd5,
    emissiveIntensity: 0.3,
  });
  const atomGeometry = new SphereGeometry(1, 40, 28);
  const rodGeometry = new CylinderGeometry(1, 1, 1, 16, 1);
  const atoms: Mesh[] = [];
  const base: Vector3[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((i * 60 + 30) * Math.PI) / 180;
    base.push(new Vector3(Math.cos(a) * 1.18, Math.sin(a) * 1.18, 0));
  }
  base.push(
    new Vector3(-2.12, 0.12, 0.36),
    new Vector3(-3.3, 0.76, 0.2),
    new Vector3(2.12, -0.12, -0.28),
    new Vector3(3.3, -0.76, 0.2),
    new Vector3(-2.25, -1.2, 0.2),
    new Vector3(2.25, 1.2, 0.1),
  );
  base.forEach((_, i) => {
    const atom = new Mesh(atomGeometry, silver);
    atom.scale.setScalar(i === 7 || i === 9 ? 0.57 : i >= 10 ? 0.12 : 0.18);
    atoms.push(atom);
    sculpture.add(atom);
  });
  const connections = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [5, 0],
    [2, 6],
    [6, 7],
    [5, 8],
    [8, 9],
    [6, 10],
    [8, 11],
  ];
  const rods = connections.map(() => {
    const mesh = new Mesh(rodGeometry, rodMaterial);
    sculpture.add(mesh);
    return mesh;
  });
  const pulse = new Mesh(atomGeometry, signalMaterial);
  pulse.scale.setScalar(0.105);
  sculpture.add(pulse);
  const positions = base.map((v) => v.clone());
  const up = new Vector3(0, 1, 0),
    delta = new Vector3(),
    direction = new Vector3(),
    projected = new Vector3();
  const path = [7, 6, 2, 1, 0, 5, 8, 9];
  const pathLengths = new Float32Array(path.length - 1);
  const project = (index: number) => {
    atoms[index].getWorldPosition(projected);
    projected.project(camera);
    return [(projected.x * 0.5 + 0.5) * 100, (-projected.y * 0.5 + 0.5) * 100];
  };
  function resize() {
    const width = host.clientWidth,
      height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const visibleHeight = Math.max(5.6, 8.9 / camera.aspect);
    camera.position.set(0, 0, visibleHeight / (2 * Math.tan(Math.PI / 12)));
    camera.updateProjectionMatrix();
  }
  resize();
  return {
    resize,
    draw(progress, time, pointer, momentum) {
      const formation = ease(progress / 0.36);
      const ownership = ease((progress - 0.45) / 0.45);
      const handoff = ease((progress - 1.45) / 0.4);
      const opening = ease((progress - 2.18) / 0.78);
      const turn = progress * 0.95;
      // One continuous turn links the chapters; slow, offset oscillations let the
      // individual atoms breathe without breaking their bonds or shaking labels.
      sculpture.rotation.set(
        -0.18 +
          Math.sin(turn) * 0.2 +
          Math.sin(time * 0.46) * 0.045 +
          pointer.y * 0.075,
        0.3 -
          Math.sin(turn * 0.85) * 0.5 +
          Math.sin(time * 0.31) * 0.08 +
          pointer.x * 0.12 +
          momentum * 0.09,
        -0.1 +
          Math.sin(turn * 1.1) * 0.16 +
          Math.sin(time * 0.38) * 0.025 -
          momentum * 0.035,
      );
      sculpture.position.set(
        Math.sin(turn) * 0.07,
        Math.sin(time * 0.55) * 0.07 + Math.sin(turn * 1.3) * 0.07,
        -opening * 0.9,
      );
      sculpture.scale.setScalar(
        (1 + Math.sin(turn) * 0.025) * (1 - opening * 0.12),
      );
      positions.forEach((v, i) => {
        v.copy(base[i]);
        const phase = base[i].x * 0.72 + base[i].y * 0.38;
        const freedom = i < 6 ? 0.42 : 1;
        v.x += Math.sin(time * 0.65 + phase) * 0.045 * freedom;
        v.y += Math.sin(time * 0.58 + phase) * 0.095 * freedom;
        v.z += Math.sin(time * 0.48 + phase + turn) * 0.13 * freedom;
        if (i === 7) {
          v.x -= ownership * 0.18 + (1 - formation) * 0.38;
          v.y += ownership * 0.2 + momentum * 0.06;
        }
        if (i === 9) {
          v.x += ownership * 0.18 + (1 - formation) * 0.38;
          v.y -= ownership * 0.2 + momentum * 0.06;
        }
        if (i >= 10) {
          const growth = ease((progress - 0.35 - (i - 10) * 0.1) / 0.6);
          v.lerpVectors(positions[i === 10 ? 6 : 8], v, growth);
          v.z += ownership * 0.2;
          atoms[i].scale.setScalar(0.12 * growth);
        }
        atoms[i].position.copy(v);
      });
      connections.forEach(([a, b], i) => {
        delta.subVectors(positions[b], positions[a]);
        const rod = rods[i];
        const growth =
          i >= 6 && i <= 9 ? ease((progress - (i - 6) * 0.025) / 0.34) : 1;
        rod.position.copy(positions[a]).addScaledVector(delta, 0.5 * growth);
        rod.quaternion.setFromUnitVectors(
          up,
          direction.copy(delta).normalize(),
        );
        rod.scale.set(0.074, delta.length() * growth, 0.074);
        rod.visible = growth > 0.005;
        if (i >= 10) rod.scale.x = rod.scale.z = 0.045;
      });
      pulse.visible = formation > 0.95 && progress < 2.7;
      let routeLength = 0;
      for (let i = 0; i < pathLengths.length; i++) {
        pathLengths[i] = positions[path[i]].distanceTo(positions[path[i + 1]]);
        routeLength += pathLengths[i];
      }
      const phase = (time * 0.13 + progress * 0.38) % 1;
      let distance = phase * routeLength;
      let segment = 0;
      while (
        segment < pathLengths.length - 1 &&
        distance > pathLengths[segment]
      ) {
        distance -= pathLengths[segment++];
      }
      pulse.position.lerpVectors(
        positions[path[segment]],
        positions[path[segment + 1]],
        distance / pathLengths[segment],
      );
      pulse.scale.setScalar(
        (0.075 + handoff * 0.035) *
          ease(phase / 0.06) *
          ease((1 - phase) / 0.06),
      );
      scene.updateMatrixWorld(true);
      renderer.render(scene, camera);
      const left = project(7),
        right = project(9);
      sculpture.getWorldPosition(projected);
      projected.project(camera);
      const center = [
        (projected.x * 0.5 + 0.5) * 100,
        (-projected.y * 0.5 + 0.5) * 100,
      ];
      return { left, right, center };
    },
    destroy() {
      atomGeometry.dispose();
      rodGeometry.dispose();
      silver.dispose();
      rodMaterial.dispose();
      signalMaterial.dispose();
      environment.dispose();
      renderer.dispose();
    },
  };
}
