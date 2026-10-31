// The hero's 3D mark: the renderer, the studio it is lit by, and one frame loop that owns
// every moving property. This is the only module that imports three, and hero.ts loads it
// with a dynamic import, so it is a separate chunk that can never hold up the page.
//
// The loop stops when nothing can change. Time comes from the scene's own clock, which
// only advances while ambient motion is allowed, so a pause holds the mark where it is
// and a return from a hidden tab carries on with no replay and no jump.
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  RGBAFormat,
  Scene,
  WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import { buildRing, type Solid } from "../lib/mark-solid";
import { atRest, damp, stepSpring, type Spring } from "../lib/spring";
import { onDensityChange } from "./density";
import { motion } from "./motion";
import type { MarkFeedback } from "../lib/mark-feedback";
import { MarkRibbon } from "../lib/mark-ribbon";

const DEG = Math.PI / 180;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

// Long lens, so the tilt reads as a photographed object rather than a wide-angle render.
const FOV = 22;
const CAMERA_DISTANCE = 652;

// YXZ order: yaw last, so the top edge stays level in the frame however far it pitches.
const REST = { yaw: -18 * DEG, pitch: -9 * DEG };

const AMBIENT = { lift: 6, yaw: 4 * DEG, pitch: 2.5 * DEG };
const HOVER_TILT = 8 * DEG;
const DRAG_TILT = { yaw: 19 * DEG, pitch: 15 * DEG };
const DRAG_RANGE = 240; // px of travel that uses up most of the bounded tilt
const SCROLL_TIP = 17 * DEG;

// Highlights travel faster than the object: the room turns a little against the tilt, which
// adds to the 2x a mirror already gives. It saturates past the hover range, because at a
// full drag the mirror alone travels far enough, and more swings the face into the dark.
const ENV_FOLLOW = { yaw: -0.9, pitch: -0.6, limit: 10 * DEG };

const SHADOW = { x: 250, y: 31, alpha: 0.17 };

const FADE = 0.5; // canvas in over the opaque poster
const REVEAL = 0.28; // poster out under the opaque canvas, shadow in
const SWEEP = 1.4;
const ENV_ARRIVAL = -0.62; // radians the light starts away from rest
const MAX_DT = 1 / 20; // a stall or a return from elsewhere never becomes a jump

// Resolution follows what a frame costs. All seconds, measured from the start of the frame's
// JavaScript to the end of its GPU work, one frame in `every`, a decision per `window` samples.
const COST = { every: 10, window: 9, slow: 0.022, calm: 0.009, giveUp: 0.5, calmWindows: 4 };

const RELEASE_SPEED = 70 * DEG; // per second: a hard flick still only overshoots a little

// Spring settings, as [angular frequency, damping ratio].
const TILT = {
  drag: [24, 1],
  release: [9.5, 0.56],
  hover: [7, 1],
  leave: [3.4, 1],
} as const;
const TILT_RELEASE_QUIET = [18, 1] as const; // paused: home directly, with no overshoot
const SCROLL_FOLLOW = [13, 1] as const;

type TiltMode = "hover" | "leave" | "drag" | "release";
type Phase = "hold" | "fade" | "reveal" | "live";

export interface HeroSceneOptions {
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  poster: HTMLElement;
  feedback: MarkFeedback;
  onLost(): void;
  /** The canvas has fully replaced the poster, on arrival or after a lost context. */
  onLive(): void;
}

export interface HeroScene {
  /** Fades the rendered first frame in over the poster. */
  reveal(): void;
  setActive(active: boolean): void;
  hover(x: number, y: number): void;
  leave(): void;
  dragStart(): void;
  drag(dx: number, dy: number): void;
  dragEnd(): void;
  turn(direction?: number): void;
  setWorking(working: boolean): void;
  settle(): void;
  scrolled(): void;
  motionChanged(): void;
  destroy(): void;
  debug?(): Record<string, unknown>;
  capture?(size: number): string;
  hold?(): void;
  place?(pose: { yaw?: number; pitch?: number; tipped?: number; sweep?: number }): void;
}

// A soft-edged card for the studio and the shadow. Values above 1 are fine: PMREM renders
// to half float, so a panel's colour is its real brightness.
function softTexture(mask: (u: number, v: number) => number, size = 64) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data.set([255, 255, 255, Math.round(255 * mask((x + 0.5) / size, (y + 0.5) / size))], i);
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const softCard = (edge: number) =>
  softTexture((u, v) => smooth(clamp01(Math.min(u, 1 - u) / edge)) * smooth(clamp01(Math.min(v, 1 - v) / edge)));

// A softbox as it really reflects: one crisp edge, then a long falloff.
const bladeCard = () =>
  softTexture((u, v) => smooth(clamp01(u / 0.05)) * (1 - u) ** 1.6 * smooth(clamp01(Math.min(v, 1 - v) / 0.12)));

interface Panel {
  /** Degrees round the mark: 0 is the camera, negative is camera left. */
  az: number;
  el: number;
  /** Degrees across, as seen from the mark. */
  size: readonly [number, number];
  roll?: number;
  /** Linear brightness. Panels add it; a flag replaces what is behind it with it. */
  power: number;
  flag?: boolean;
  tint?: number;
  soft?: "wide" | "tight" | "blade";
}

// A photographer's table for polished metal on white. The face is nearly flat, so at any one
// moment it reflects a window of the room only about 30 degrees wide, and the rest pose's
// window is centred on az -36, el 18. What makes that frame read as metal is one feature: a
// crisp edge, a long falloff, a dark gap. So the wall the mark faces is a bank of those, spaced
// closer than the window, and wherever a hover or a drag points the face it still finds all
// three instead of settling inside one flat light. The arrival is the same bank seen 35
// degrees along, so the sweep is its crisp edges crossing the metal.
const BLADE_ROLL = 204; // the blades' crisp edge leads, on the camera-left side
const STUDIO: readonly Panel[] = [
  { az: -76, el: 17, size: [18, 150], roll: BLADE_ROLL, power: 2.2, soft: "blade" },
  // Rest: the face sees this blade's falloff, from silver into graphite...
  { az: -36, el: 17, size: [30, 150], roll: BLADE_ROLL, power: 1.25, soft: "blade" },
  // ...and this narrow strip well over 1, so one band of the face really clips.
  { az: -50, el: 17, size: [3, 150], roll: BLADE_ROLL, power: 14 },
  { az: -8, el: 17, size: [26, 150], roll: BLADE_ROLL, power: 2.6, soft: "blade" },
  { az: 24, el: 17, size: [30, 150], roll: BLADE_ROLL, power: 2.4, soft: "blade" },
  // The gaps, each its own flag, so the dark survives whatever the blades add up to.
  { az: -94, el: 17, size: [16, 150], roll: BLADE_ROLL, power: 0.03, flag: true, soft: "tight" },
  { az: -62, el: 17, size: [18, 150], roll: BLADE_ROLL, power: 0.03, flag: true, soft: "tight" },
  { az: -32, el: 17, size: [9, 150], roll: BLADE_ROLL, power: 0.02, flag: true, soft: "tight" },
  { az: -3, el: 17, size: [11, 150], roll: BLADE_ROLL, power: 0.03, flag: true, soft: "tight" },
  { az: 30, el: 17, size: [11, 150], roll: BLADE_ROLL, power: 0.03, flag: true, soft: "tight" },
  // Above and to the sides for the bevels, kept higher than the face ever looks.
  { az: -30, el: 82, size: [120, 24], power: 8 },
  { az: 84, el: 12, size: [8, 70], power: 4 },
  { az: -125, el: 20, size: [26, 90], power: 5 },
  // The walls see the back of the room at a grazing angle: a soft wash over a dark floor, so
  // they shade from graphite into silver instead of sitting as one black band.
  { az: 165, el: 14, size: [130, 46], power: 0.5 },
  // Dark below, so every stroke reads as raised, not engraved: a horizon, then a gap where
  // the blades still show, then the floor. Graphite rather than black, and broken up, so a
  // face tipped down into it still reads as metal.
  { az: 10, el: -8, size: [165, 12], power: 0.06, flag: true, soft: "tight" },
  { az: 10, el: -42, size: [165, 30], power: 0.06, flag: true, soft: "tight" },
  { az: 180, el: -34, size: [150, 46], power: 0, flag: true },
  { az: 128, el: 8, size: [30, 44], power: 0.16, tint: 0xa9c1ff },
];

const STUDIO_RADIUS = 10;

function buildEnvironment(renderer: WebGLRenderer) {
  const studio = new Scene();
  studio.background = new Color(0.07, 0.075, 0.085);

  const textures = { wide: softCard(0.34), tight: softCard(0.14), blade: bladeCard() };
  const plane = new PlaneGeometry(1, 1);
  const materials: MeshBasicMaterial[] = [];

  STUDIO.forEach((panel, order) => {
    const material = new MeshBasicMaterial({
      map: textures[panel.soft ?? "wide"],
      color: new Color(panel.tint ?? 0xffffff).multiplyScalar(panel.power),
      side: DoubleSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: panel.flag ? NormalBlending : AdditiveBlending,
    });
    materials.push(material);
    const mesh = new Mesh(plane, material);
    const az = panel.az * DEG;
    const el = panel.el * DEG;
    mesh.position
      .set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
      .multiplyScalar(STUDIO_RADIUS);
    mesh.scale.set(
      2 * STUDIO_RADIUS * Math.tan((Math.min(panel.size[0], 160) * DEG) / 2),
      2 * STUDIO_RADIUS * Math.tan((Math.min(panel.size[1], 160) * DEG) / 2),
      1,
    );
    mesh.lookAt(0, 0, 0);
    mesh.rotateZ((panel.roll ?? 0) * DEG);
    // Flags go down last, so they cut into the light as a card held in front of it does.
    mesh.renderOrder = panel.flag ? 100 + order : order;
    studio.add(mesh);
  });

  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(studio, 0.006, 0.1, 40);
  pmrem.dispose();
  plane.dispose();
  materials.forEach((material) => material.dispose());
  Object.values(textures).forEach((texture) => texture.dispose());
  return target;
}

// Hands the main thread back between the heavy steps of the build, so it is a few short
// tasks and never one long one.
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve));

function toGeometry(solid: Solid) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(solid.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(solid.normals, 3));
  geometry.setIndex(new BufferAttribute(solid.indices, 1));
  return geometry;
}

export async function createHeroScene(options: HeroSceneOptions): Promise<HeroScene> {
  const { stage, canvas, gl, poster, feedback, onLost, onLive } = options;

  const renderer = new WebGLRenderer({ canvas, context: gl, antialias: true, alpha: true, stencil: false });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  let shaderFailed = false;
  renderer.debug.onShaderError = () => {
    shaderFailed = true;
  };

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 100, 1000);
  camera.position.z = CAMERA_DISTANCE;

  await breathe();
  let environment: WebGLRenderTarget = buildEnvironment(renderer);
  scene.environment = environment.texture;
  await breathe();

  const metal = new MeshStandardMaterial({
    color: 0xeef0f3,
    metalness: 1,
    roughness: 0.15,
    dithering: true,
  });

  const ringGeometry = toGeometry(buildRing());
  const object = new Group();
  object.rotation.order = "YXZ";
  object.add(new Mesh(ringGeometry, metal));
  const bondMaterial = metal.clone();
  bondMaterial.vertexColors = true;
  const bondGeometry = [new MarkRibbon(60), new MarkRibbon(60), new MarkRibbon(60)];
  const bondMeshes = bondGeometry.map(geometry => new Mesh(geometry, bondMaterial));
  object.add(...bondMeshes);
  // At the completed glyph its three adjacent sections are one seamless stroke.
  const joinedGeometry = new MarkRibbon(180);
  const joinedMesh = new Mesh(joinedGeometry, bondMaterial);
  object.add(joinedMesh);
  let lastShape = "";
  scene.add(object);

  // The grounding shadow is a soft card in the scene, not a filter on the page.
  const shadowTexture = softTexture((u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    return smooth(clamp01(1 - d)) ** 1.5;
  }, 128);
  const shadowPlane = new PlaneGeometry(1, 1);
  const shadowMaterial = new MeshBasicMaterial({
    map: shadowTexture,
    color: 0x20242a,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const shadow = new Mesh(shadowPlane, shadowMaterial);
  shadow.position.set(0, -111, -24);
  scene.add(shadow);

  // Read once per change and never per frame. In Chromium, reading a media query's
  // `matches` from a frame callback consumes the pending change, so polling here would
  // stop the change event reaching this and every other subscriber.
  let ambient = motion.ambient;
  let reduced = motion.reduced;

  // State. Each spring has one owner; nothing else writes to it.
  const tiltYaw: Spring = { x: 0, v: 0 };
  const tiltPitch: Spring = { x: 0, v: 0 };
  const tip: Spring = { x: 0, v: 0 };
  let target = { yaw: 0, pitch: 0 };
  let dragBase = { yaw: 0, pitch: 0 };
  let tiltMode: TiltMode = "leave";
  let releaseAge = 0;
  let tipTarget = 0;
  let scrollDirty = true;
  let compact = window.innerWidth < 1000;

  let phase: Phase = "hold";
  let phaseAge = 0;
  let clock = 0; // seconds of ambient life; stops while paused, hidden or reduced
  let rate = ambient ? 1 : 0; // eases the clock, so a pause settles instead of freezing
  let ambientGain = 1; // falls to 0 at once under reduced motion, recovers calmly after
  let sweepAge = SWEEP;

  let frame = 0;
  let lastTime = 0;
  let dirty = true;
  let active = false;
  let lost = false;
  let destroyed = false;

  // Adaptive resolution: down when frames cost too much, back up once they cost little.
  let ratioCeiling = 2;
  let framesSinceTimed = 0;
  let timing = false;
  const costs: number[] = [];
  let lastCost = 0;
  let calmWindows = 0;
  let calmNeeded = COST.calmWindows;
  let climbed = false; // a fall straight after a climb means the cap is out of reach for now
  let heldRatio = false; // dev only: lets a test pin the resolution

  // Spreads and lightens a touch as the mark lifts, and thins as it leans.
  const drawShadow = (strength: number) => {
    const lift = object.position.y / (compact ? 8 : AMBIENT.lift); // -1..1 through the drift
    const leaning = Math.abs(tiltYaw.x) + Math.abs(tiltPitch.x) + Math.abs(tip.x);
    shadow.position.x = tiltYaw.x * 62 + object.position.x;
    shadow.scale.set(
      SHADOW.x * (1 + 0.04 * lift) * (1 - 0.1 * Math.min(1, Math.abs(tiltYaw.x) / DRAG_TILT.yaw)),
      SHADOW.y * (1 + 0.06 * lift + 0.5 * Math.sin(Math.abs(tip.x))),
      1,
    );
    shadowMaterial.opacity = strength * SHADOW.alpha * (1 - 0.08 * lift - 0.35 * Math.min(1, leaning));
  };

  const pose = () => {
    const a = Math.sin(Math.min(clock / 1.6, 1) * (Math.PI / 2)) ** 2 * ambientGain; // ambient eases in from nothing
    const t = clock * Math.PI * 2;
    object.position.x = 1.8 * a * Math.sin(t / 9.7);
    object.rotation.z = 1.4 * DEG * a * Math.sin(t / 8.1);
    object.position.y = (compact ? 8 : AMBIENT.lift) * a * Math.sin(t / 6.8);
    object.rotation.y = REST.yaw + tiltYaw.x + (compact ? 5 * DEG : AMBIENT.yaw) * a * Math.sin(t / 11.3);
    object.rotation.x = REST.pitch + tiltPitch.x + tip.x + (compact ? 3 * DEG : AMBIENT.pitch) * a * Math.sin(t / 8.3);
    const shape = `${feedback.rotation}/${feedback.circle}/${feedback.done}/${feedback.comet}`;
    if (shape !== lastShape) {
      lastShape = shape;
      const points = feedback.points();
      const joined = feedback.done === 1;
      joinedMesh.visible = joined;
      if (joined) joinedGeometry.update(points);
      bondMeshes.forEach((mesh, i) => {
        mesh.visible = !joined;
        if (!joined) bondGeometry[i]!.update(points.slice(i * 60, i * 60 + 60), i * .002);
      });
    }

    const sweep = smooth(clamp01(sweepAge / SWEEP));
    const follow = (tilt: number) => ENV_FOLLOW.limit * Math.tanh(tilt / ENV_FOLLOW.limit);
    scene.environmentRotation.y = ENV_ARRIVAL * (1 - sweep) + follow(tiltYaw.x) * ENV_FOLLOW.yaw;
    scene.environmentRotation.x = follow(tiltPitch.x) * ENV_FOLLOW.pitch;
  };

  const draw = () => {
    pose();
    const strength = phase === "live" ? 1 : phase === "reveal" ? smooth(clamp01(phaseAge / REVEAL)) : 0;
    drawShadow(strength);
    renderer.render(scene, camera);
  };

  const stepTilt = (dt: number) => {
    // Paused, a drag is still direct: it lands on the pointer, with no lag to read as motion.
    if (tiltMode === "drag" && !ambient) {
      tiltYaw.x = target.yaw;
      tiltPitch.x = target.pitch;
      tiltYaw.v = tiltPitch.v = 0;
      return;
    }
    const settings = tiltMode === "release" && !ambient ? TILT_RELEASE_QUIET : TILT[tiltMode];
    stepSpring(tiltYaw, target.yaw, settings[0], settings[1], dt);
    stepSpring(tiltPitch, target.pitch, settings[0], settings[1], dt);
  };

  const snapToRest = () => {
    tiltYaw.x = tiltYaw.v = tiltPitch.x = tiltPitch.v = tip.x = tip.v = 0;
    target = { yaw: 0, pitch: 0 };
    tipTarget = 0;
    tiltMode = "leave";
    feedback.update(0, false);
  };

  const readScroll = () => {
    if (!scrollDirty) return;
    scrollDirty = false;
    if (!ambient) {
      tipTarget = 0;
      return;
    }
    // On phones the mark responds throughout its visible travel, below the form.
    // Desktop keeps the original tip as the mark passes under the header.
    const rect = stage.getBoundingClientRect();
    tipTarget = compact
      ? 12 * DEG * (0.5 - smooth(clamp01((window.innerHeight - rect.top) / (window.innerHeight + rect.height))))
      : -SCROLL_TIP * smooth(clamp01((88 - rect.top) / (rect.height * 0.8)));
  };

  const setPhase = (next: Phase) => {
    phase = next;
    phaseAge = 0;
    if (next === "fade") canvas.style.opacity = "0";
    if (next === "reveal") canvas.style.opacity = "1";
    if (next === "live") {
      canvas.style.opacity = "1";
      poster.style.visibility = "hidden";
      poster.style.opacity = "";
      onLive();
    }
  };

  const step = (dt: number) => {
    phaseAge += dt;
    if (phase === "fade") {
      canvas.style.opacity = smooth(clamp01(phaseAge / FADE)).toFixed(3);
      if (phaseAge >= FADE) setPhase("reveal");
    } else if (phase === "reveal") {
      // The canvas is opaque over the metal by now, so only the shadow and the edges change.
      poster.style.opacity = (1 - smooth(clamp01(phaseAge / REVEAL))).toFixed(3);
      if (phaseAge >= REVEAL) setPhase("live");
    }

    const wanted = ambient ? 1 : 0;
    rate = damp(rate, wanted, 3.2, dt);
    if (Math.abs(rate - wanted) < 0.004) rate = wanted;
    // The poster is still on the page until `live`, so until then the canvas has to stay its
    // exact twin: nothing that moves the form or the light may start any earlier.
    const live = phase === "live";
    if (live) {
      clock += dt * rate;
      if (sweepAge < SWEEP) sweepAge += dt * rate;
    }
    if (ambientGain < 1 && ambient) ambientGain = Math.min(1, ambientGain + dt / 1.4);

    feedback.update(dt, ambient);

    if (tiltMode === "release") {
      releaseAge += dt;
      if (releaseAge > 1.1) tiltMode = target.yaw || target.pitch ? "hover" : "leave";
    }

    if (live) readScroll();
    stepTilt(dt);
    stepSpring(tip, tipTarget, SCROLL_FOLLOW[0], SCROLL_FOLLOW[1], dt);
  };

  const needsFrame = () => {
    if (dirty || phase === "fade" || phase === "reveal") return true;
    if (ambient || rate > 0) return true;
    return !atRest(tiltYaw, target.yaw) || !atRest(tiltPitch, target.pitch) || (ambient && feedback.animating) || !atRest(tip, tipTarget);
  };

  const schedule = () => {
    if (frame || destroyed) return;
    if (active && !lost && needsFrame()) frame = requestAnimationFrame(tick);
    else lastTime = 0;
  };

  const invalidate = () => {
    dirty = true;
    schedule();
  };

  const weighCost = (cost: number) => {
    costs.push(cost);
    if (costs.length < COST.window) return;
    costs.sort((a, b) => a - b);
    lastCost = costs[COST.window >> 1] ?? 0; // the median, so one long task elsewhere is not a verdict
    costs.length = 0;
    if (import.meta.env.DEV && heldRatio) return;
    const current = Math.min(ratioCeiling, deviceCap);
    if (lastCost > COST.slow && current > 1) {
      ratioCeiling = Math.max(1, current - 0.25);
      if (climbed) calmNeeded *= 2; // hunting, so it waits longer before it tries again
      climbed = false;
      calmWindows = 0;
      resize();
    } else if (lastCost < COST.calm && current < deviceCap && ++calmWindows >= calmNeeded) {
      ratioCeiling = current + 0.25;
      climbed = true;
      calmWindows = 0;
      resize();
    } else if (lastCost >= COST.calm) {
      calmWindows = 0;
    }
  };

  // How often frames arrive says nothing about how hard they were: a 30Hz display or Low Power
  // Mode delivers a steady 33ms with room to spare, and so does a GPU that is out of time on a
  // 60Hz one. So this times the work instead. A fence marks the end of the frame's GPU commands,
  // and it is polled from timers, which never blocks the page the way a readback would.
  const timeFrame = (started: number) => {
    if (timing || ++framesSinceTimed < COST.every) return;
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) return;
    gl.flush();
    framesSinceTimed = 0;
    timing = true;
    const poll = () => {
      if (destroyed || lost) {
        timing = false;
        return;
      }
      const cost = (performance.now() - started) / 1000;
      if (gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED && cost < COST.giveUp) {
        setTimeout(poll, 1);
        return;
      }
      gl.deleteSync(fence);
      timing = false;
      // Background tabs throttle timers, so a reading taken across a hide is not a reading.
      if (active) weighCost(cost);
    };
    setTimeout(poll);
  };

  const tick = (now: number) => {
    frame = 0;
    const started = performance.now(); // a stopwatch for this frame's cost, not a timeline
    const raw = lastTime ? (now - lastTime) / 1000 : 1 / 60;
    lastTime = now;
    dirty = false;
    step(Math.min(raw, MAX_DT));
    draw();
    timeFrame(started);
    schedule();
  };

  // Square by construction: the stage reserves it before anything loads.
  let stageSize = stage.clientWidth;
  let deviceCap = 2; // kept here so the cost check never has to read the window
  const sizeBuffer = () => {
    if (!stageSize) return;
    deviceCap = Math.min(window.devicePixelRatio || 1, window.innerWidth < 640 ? 1.75 : 2);
    renderer.setDrawingBufferSize(stageSize, stageSize, Math.min(deviceCap, ratioCeiling));
  };
  const resize = () => {
    compact = window.innerWidth < 1000;
    scrollDirty = true;
    sizeBuffer();
    if (!lost && !destroyed) draw();
  };
  const observer = new ResizeObserver(([entry]) => {
    const next = Math.round(entry?.contentRect.width ?? 0);
    if (next === stageSize) return;
    stageSize = next;
    resize();
  });
  observer.observe(stage);
  const stopDensity = onDensityChange(resize);

  const handleLost = () => {
    lost = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
    canvas.style.opacity = "0";
    poster.style.visibility = "";
    poster.style.opacity = "";
    // Released now, while GL calls are no-ops: after a restore these handles are foreign.
    environment.dispose();
    onLost();
  };

  const handleRestored = () => {
    if (destroyed) return;
    lost = false;
    // The restored context has none of the old render targets, so the lighting is rebuilt.
    environment = buildEnvironment(renderer);
    scene.environment = environment.texture;
    resize();
    setPhase("live");
    invalidate();
  };

  canvas.addEventListener("webglcontextlost", handleLost);
  canvas.addEventListener("webglcontextrestored", handleRestored);

  const syncMotion = () => {
    ambient = motion.ambient;
    reduced = motion.reduced;
    if (reduced) {
      // Stable pose: anything in flight lands now, and a sweep underway finishes.
      ambientGain = 0;
      rate = 0;
      if (sweepAge > 0) sweepAge = SWEEP;
      snapToRest();
      if (phase === "fade" || phase === "reveal") setPhase("live");
    } else if (!ambient && tiltMode !== "drag") {
      // A held drag stays on the pointer, and dragEnd sends it home.
      target = { yaw: 0, pitch: 0 };
      tiltMode = "leave";
    }
    scrollDirty = true;
    invalidate();
  };

  const release = () => {
    destroyed = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    observer.disconnect();
    stopDensity();
    canvas.removeEventListener("webglcontextlost", handleLost);
    canvas.removeEventListener("webglcontextrestored", handleRestored);
    ringGeometry.dispose();
    bondGeometry.forEach(geometry => geometry.dispose());
    joinedGeometry.dispose();
    bondMaterial.dispose();
    metal.dispose();
    shadowPlane.dispose();
    shadowMaterial.dispose();
    shadowTexture.dispose();
    environment.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  };

  // Sized, not drawn: a draw here would compile the shaders synchronously, ahead of this.
  sizeBuffer();
  await renderer.compileAsync(scene, camera);
  await breathe();
  draw();
  if (shaderFailed || gl.isContextLost()) {
    release();
    throw new Error("The mark's material did not compile.");
  }

  // Dev-only poster and test hooks. import.meta.env.DEV is false in a build, so these go.
  const devHooks: Pick<HeroScene, "debug" | "capture" | "hold" | "place"> = import.meta.env.DEV
    ? {
        debug: () => ({
          phase,
          feedback: { rotation: feedback.rotation, target: feedback.target, circle: feedback.circle, done: feedback.done, status: feedback.status },
          clock,
          rate,
          sweepAge,
          tiltYaw: tiltYaw.x / DEG,
          tiltPitch: tiltPitch.x / DEG,
          bond: feedback.rotation,
          bondTarget: feedback.target,
          tip: tip.x / DEG,
          lift: object.position.y,
          envYaw: scene.environmentRotation.y,
          ratioCeiling,
          frameCost: lastCost,
          renderCalls: renderer.info.render.frame,
          running: frame !== 0,
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          shadowAlpha: shadowMaterial.opacity,
          buffer: [canvas.width, canvas.height],
        }),
        hold() {
          heldRatio = true;
        },
        place({ yaw = 0, pitch = 0, tipped = 0, sweep = SWEEP }) {
          tiltYaw.x = target.yaw = yaw * DEG;
          tiltPitch.x = target.pitch = pitch * DEG;
          tip.x = tipTarget = tipped * DEG;
          tiltYaw.v = tiltPitch.v = tip.v = 0;
          sweepAge = sweep;
          clock = 0;
          tiltMode = "leave";
          draw();
        },
        capture(size) {
          heldRatio = true;
          const held = phase;
          phase = "live"; // the poster carries the shadow the first frame fades it in under
          renderer.setDrawingBufferSize(size, size, 1);
          draw();
          const png = canvas.toDataURL("image/png");
          phase = held;
          return png;
        },
      }
    : {};

  return {
    ...devHooks,

    reveal() {
      if (phase !== "hold") return;
      // Swap only after a complete frame exists. Two semi-transparent, differently lit
      // copies of the mark used to overlap here and the moving poster snapped to rest.
      phase = "live";
      draw();
      setPhase("live");
      invalidate();
    },

    setActive(next) {
      if (active === next) return;
      active = next;
      lastTime = 0;
      if (next) {
        if (motion.ambient !== ambient) syncMotion();
        scrollDirty = true;
        schedule();
      } else if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    },

    hover(x, y) {
      if (!ambient || tiltMode === "drag") return;
      target = { yaw: x * HOVER_TILT, pitch: y * HOVER_TILT };
      if (tiltMode !== "release") tiltMode = "hover";
      schedule();
    },

    leave() {
      if (tiltMode === "drag") return;
      target = { yaw: 0, pitch: 0 };
      if (tiltMode !== "release") tiltMode = "leave";
      schedule();
    },

    dragStart() {
      if (reduced) return;
      dragBase = { yaw: tiltYaw.x, pitch: tiltPitch.x };
      tiltMode = "drag";
      schedule();
    },

    drag(dx, dy) {
      if (tiltMode !== "drag") return;
      const within = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
      target = {
        yaw: within(dragBase.yaw + DRAG_TILT.yaw * Math.tanh(dx / DRAG_RANGE), DRAG_TILT.yaw),
        pitch: within(dragBase.pitch + DRAG_TILT.pitch * Math.tanh(dy / DRAG_RANGE), DRAG_TILT.pitch),
      };
      schedule();
    },

    dragEnd() {
      if (tiltMode !== "drag") return;
      target = { yaw: 0, pitch: 0 };
      tiltMode = "release";
      releaseAge = 0;
      for (const axis of [tiltYaw, tiltPitch]) axis.v = Math.max(-RELEASE_SPEED, Math.min(RELEASE_SPEED, axis.v));
      schedule();
    },

    turn(direction = 1) {
      feedback.hop(direction);
      if (!ambient) feedback.update(0, false);
      invalidate();
    },

    setWorking(next) {
      feedback.setWorking(next);
      invalidate();
    },

    settle() {
      feedback.finish();
      if (!ambient) feedback.update(0, false);
      invalidate();
    },

    scrolled() {
      if (!ambient) return;
      scrollDirty = true;
    },

    motionChanged: syncMotion,

    destroy: release,
  };
}
