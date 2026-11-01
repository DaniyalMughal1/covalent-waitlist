// The hero in WebGL: the Covalent ring in polished metal (the studio and material from
// main), over a faint honeycomb of benzene rings in clear glass. The honeycomb stands on the paper as the page
// arrives and the wave from the ring lays it flat; after that the cursor stirs a small
// fluid (src/lib/fluid.ts) and the honeycomb rises wherever it flows, then settles back.
//
// One three.js scene. hero.ts loads this with a dynamic import, a separate chunk that can
// never hold up the page. The
// page's flat SVG ring is the layout: each frame reads its box, and a lens shift puts the
// 3D ring exactly there, cropped by the window on desktop, glide included.
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
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import { buildRing, type Solid } from "../lib/mark-solid";
import { MarkRibbon } from "../lib/mark-ribbon";
import { Fluid } from "../lib/fluid";
import { atRest, damp, stepSpring, type Spring } from "../lib/spring";
import { onDensityChange } from "./density";
import { motion } from "./motion";
import type { MarkFeedback } from "../lib/mark-feedback";
import type { RingBox } from "./hero-mark";

const DEG = Math.PI / 180;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (t: number) => t * t * (3 - 2 * t);
const inOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

// Long lens, so the tilt reads as a photographed object rather than a wide-angle render.
const FOV = 22;

// YXZ order: yaw last, so the top edge stays level in the frame however far it pitches.
const REST = { yaw: -18 * DEG, pitch: -9 * DEG };
const AMBIENT = { lift: 4, yaw: 3 * DEG, pitch: 2 * DEG };
const HOVER_TILT = 7 * DEG;
const SCROLL_TIP = 14 * DEG;
const TILT = { hover: [6, 1], leave: [3.4, 1] } as const;
const SCROLL_FOLLOW = [13, 1] as const;
// Highlights travel faster than the object: the room turns a little against the tilt.
const ENV_FOLLOW = { yaw: -0.9, pitch: -0.6, limit: 10 * DEG };
// The grounding shadow: a soft card this far below the ring's centre, in mark units, and
// this wide and tall.
const SHADOW = { x: 250, y: 31, alpha: 0.17, drop: 111 };
const SWEEP = 1.4; // the studio light crossing the metal on arrival
const ENV_ARRIVAL = -0.62; // radians the light starts away from rest

// The canvas fades in over the page's flat lattice, holds, then the honeycomb ripples away.
const FADE_MS = 420;
// Two waves out from the ring: the first raises the honeycomb, the second lays it flat.
const WAVE_HOLD = 0.25;
const WAVE_IN = 1.7;
const WAVE_GAP = 0.35;
const WAVE_OUT = 1.9;
const RIPPLE_BAND = 150; // CSS px either side of a wavefront
const QUIET = { rise: 0.5, hold: 0.4, fall: 0.6 }; // reduced motion: a fade in and out instead

// The cursor's brush, in CSS px, and how much of its speed reaches the fluid.
const FLUID_COLS = 96;
const BRUSH = 46;
const FORCE = 0.4;
const MAX_POINTER_SPEED = 3200;
const FLOW_SCALE = 90; // cells per second that fill the encoded velocity range
// The raised trail lingers a little before it sinks back, so the relief can be read.
const TRAIL = { velocityHalfLife: 0.3, dyeHalfLife: 0.9 };

// Resolution follows what a frame costs (see weighCost). The full-bleed canvas starts a
// little under the device ratio and climbs once frames prove cheap.
const COST = { every: 10, window: 9, slow: 0.022, calm: 0.009, giveUp: 0.5, calmWindows: 4 };
const START_RATIO = 1.5;

export interface HeroSceneOptions {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  field: HTMLElement;
  feedback: MarkFeedback;
  /** Where the page's layout ring is right now, in client px. */
  ring(): RingBox | undefined;
  /** The headline and the form, which the honeycomb stays faint behind. */
  copy: Element[];
  /** The honeycomb's circumradius, CSS px: the same lattice as the page's SVG. */
  cell: number;
  wake(): void;
  onLost(): void;
}

export interface HeroScene {
  /** Advances by dt seconds and draws. dt = 0 only redraws. */
  frame(dt: number): void;
  readonly needsFrame: boolean;
  /**
   * Fades the canvas in over the page. "ripple" sends two waves out from the ring, the
   * first raising the honeycomb and the second laying it flat; "none" arrives without them.
   */
  reveal(lattice: "ripple" | "none", shown: () => void): void;
  hover(clientX: number, clientY: number): void;
  leave(): void;
  motionChanged(): void;
  destroy(): void;
  debug(): Record<string, unknown>;
  /** Dev only: holds the arrival wave at `age` seconds (a negative age lets it go). */
  scrub?(age: number): void;
}

// ---------- the studio the metal reflects (from main) ----------
// A soft-edged card for the studio and the shadow.
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

const breathe = () => new Promise<void>((resolve) => setTimeout(resolve));

function toGeometry(solid: Solid) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(solid.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(solid.normals, 3));
  geometry.setIndex(new BufferAttribute(solid.indices, 1));
  return geometry;
}

/** A CSS colour token as 0..1 sRGB. */
function token(name: string, fallback: string): [number, number, number] {
  const value = (name && getComputedStyle(document.documentElement).getPropertyValue(name).trim()) || fallback;
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1] ?? fallback.slice(1);
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}

// ---------- the honeycomb ----------
// A full-screen pass in the scene itself, drawn first and outside the camera. Positions
// are CSS px in the field, y down, from the vertex varying.
const LATTICE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const LATTICE_FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform vec2 uSize;
uniform float uCell;
uniform vec3 uPaper;
uniform sampler2D uFluid;
uniform float uFlowScale;
uniform float uTime;
uniform vec2 uRippleCentre;
uniform float uRipple;
uniform float uRipple2;
uniform float uRippleBand;
uniform float uLoad;
uniform vec4 uCopy;

const float PI = 3.14159265;
const float SQ3 = 1.7320508;
// How much of the glass reaches the page: a faint presence, never a pattern to read.
const float INTENSITY = 0.25;
// Glass rods along every bond and a bead at every carbon, at full rise, in CSS px.
const float HEIGHT = 6.0;
const float BOND = 0.12; // rod half-width, as a share of the ring's radius
const float ATOM = 0.2; // bead radius, the same way
// How far the glass bends what is under it: px of shift per px of height and slope.
const float BEND = 1.6;
// Thick glass darkens a touch, evenly: clear glass with no colour of its own.
const float THICK_SHADE = 0.95;

// Offset from the nearest centre of a flat-topped honeycomb (circumradius a) whose centres
// sit at (1.5a i, sqrt3 a (j + i/2)): two rectangular grids, take the nearer centre.
vec2 hexLocal(vec2 p, float a) {
  vec2 sp = vec2(3.0 * a, SQ3 * a);
  vec2 o = vec2(1.5 * a, 0.5 * SQ3 * a);
  vec2 l1 = p - sp * floor(p / sp + 0.5);
  vec2 l2 = p - o - sp * floor((p - o) / sp + 0.5);
  return dot(l1, l1) < dot(l2, l2) ? l1 : l2;
}

// A glass rod's round cross-section: nearly flat across the top, steep only at its edge.
float profile(float t) {
  float c = clamp(t, 0.0, 1.0);
  // The last tenth eases down to the paper, so the edge stays clean at any pixel density.
  return sqrt(max(1.0 - c * c, 0.0)) * (1.0 - smoothstep(0.88, 1.0, c) * 0.6);
}

float relief(vec2 p) {
  vec2 q = abs(hexLocal(p, uCell));
  float apothem = 0.8660254 * uCell;
  float edge = apothem - max(q.y, q.x * 0.8660254 + q.y * 0.5);
  float bond = profile(edge / (BOND * uCell));
  float atom = min(length(q - vec2(uCell, 0.0)), length(q - vec2(0.5 * uCell, apothem)));
  return HEIGHT * max(bond, 1.15 * profile(atom / (ATOM * uCell)));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
}
// The paper's own faint tooth, which the glass magnifies and bends.
float grain(vec2 p) {
  return 0.55 * noise(p * 0.05) + 0.45 * noise(p * 0.23);
}

// One key light from the upper left.
const vec3 LIGHT = vec3(-0.4725, -0.6014, 0.6443);

// The paper at q, as light reaches it through the glass: a pale shadow behind each rod,
// with a bright caustic line inside it where the rod focuses the light.
float paper(vec2 q, float rise) {
  vec2 toward = normalize(LIGHT.xy);
  float climb = LIGHT.z / length(LIGHT.xy);
  float shade = 1.0;
  float caustic = 0.0;
  for (int i = 1; i <= 7; i++) {
    float s = float(i) * 1.8;
    float h = relief(q + toward * s) * rise;
    float through = h - s * climb; // glass the light passes through on its way here
    if (through > 0.0) {
      float k = through / (HEIGHT * rise + 1e-3);
      shade = min(shade, 1.0 - 0.14 * smoothstep(0.0, 0.35, k));
      caustic = max(caustic, exp(-pow((k - 0.6) / 0.16, 2.0)));
    }
  }
  return (shade + caustic * 0.12 * rise) * (1.0 + (grain(q) - 0.5) * 0.025 * rise);
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 p = uv * uSize;

  vec4 fluid = texture2D(uFluid, uv);

  // How far the glass honeycomb stands off the paper here: where the cursor's trail is, and
  // on arrival between two waves from the ring, the first raising it, the second laying it
  // flat again.
  vec2 fromRing = p - uRippleCentre;
  float d = length(fromRing);
  float first = (d - uRipple) / uRippleBand;
  float second = (d - uRipple2) / uRippleBand;
  float crest = uLoad * (exp(-first * first * 2.5) + exp(-second * second * 2.5));
  float arriving = uLoad * (1.0 - smoothstep(-1.0, 1.0, first)) * smoothstep(-1.0, 1.0, second);
  // Low behind the headline and the form, so they always read first.
  vec2 outside = max(max(uCopy.xy - p, p - uCopy.zw), 0.0);
  float clear = mix(0.4, 1.0, smoothstep(0.0, 260.0, length(outside)));
  float rise = clamp(max(smoothstep(0.04, 0.6, fluid.r) * 0.8, arriving) + crest * 0.3, 0.0, 1.0) * clear;
  if (rise < 0.003) {
    gl_FragColor = vec4(uPaper, 1.0);
    return;
  }

  float h0 = relief(p) * rise;
  float e = 0.5;
  vec3 n = normalize(vec3(-(relief(p + vec2(e, 0.0)) * rise - h0) / e, -(relief(p + vec2(0.0, e)) * rise - h0) / e, 1.0));
  float glass = smoothstep(0.0, 0.35, h0);

  // What shows through: the paper under the glass, bent by its slope. Every colour bends
  // alike, so the edges stay clean, with no fringes.
  vec3 color = uPaper * paper(p - n.xy * h0 * BEND * glass, rise);
  float steep = 1.0 - n.z;
  // Thick glass darkens a touch; only its very edge, turned to the darker room, rims dark.
  color *= mix(1.0, THICK_SHADE, glass * clamp(h0 / HEIGHT, 0.0, 1.0));
  color *= 1.0 - 0.42 * glass * smoothstep(0.55, 0.97, steep);

  // The room reflected at grazing angles: mostly bright, a softbox up and to the left, and
  // darker only where a face turns to the floor.
  vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
  float room = mix(0.9, 1.2, smoothstep(0.2, 0.8, dot(normalize(r), LIGHT)));
  room *= mix(0.72, 1.0, smoothstep(0.5, -0.1, r.y));
  float fresnel = 0.04 + 0.96 * pow(steep, 5.0);
  color = mix(color, uPaper * room, fresnel * glass);
  // A crisp highlight along each rod, a softer sheen around it, and the glow glass carries
  // to its far edge, away from the light.
  float facing = max(dot(n, normalize(LIGHT + vec3(0.0, 0.0, 1.0))), 0.0);
  color += glass * (pow(facing, 160.0) * 0.9 + pow(facing, 22.0) * 0.07);
  color += glass * 0.1 * smoothstep(0.6, 0.95, steep) * max(dot(normalize(n.xy + 1e-5), -normalize(LIGHT.xy)), 0.0);

  gl_FragColor = vec4(mix(uPaper, min(color, vec3(1.0)), INTENSITY), 1.0);
}`;

export async function createHeroScene(options: HeroSceneOptions): Promise<HeroScene> {
  const { canvas, gl, field, feedback, ring, copy, cell, wake, onLost } = options;

  const renderer = new WebGLRenderer({ canvas, context: gl, antialias: true, alpha: true, stencil: false });
  const paper = token("--paper", "#faf9f6");
  renderer.setClearColor(new Color().setRGB(...paper), 1);
  // For the metal; the honeycomb pass writes its page colours directly and is not tone mapped.
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  let shaderFailed = false;
  renderer.debug.onShaderError = () => {
    shaderFailed = true;
  };

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 1, 2000);

  await breathe();
  let environment: WebGLRenderTarget = buildEnvironment(renderer);
  scene.environment = environment.texture;
  await breathe();

  // ---- the honeycomb ----
  let fluid = new Fluid(FLUID_COLS, 60, TRAIL);
  let fluidData = new Uint8Array(FLUID_COLS * 60 * 4);
  let fluidTexture = new DataTexture(fluidData, FLUID_COLS, 60, RGBAFormat, UnsignedByteType);
  const lattice = new ShaderMaterial({
    vertexShader: LATTICE_VERTEX,
    fragmentShader: LATTICE_FRAGMENT,
    uniforms: {
      uSize: { value: new Vector2(1, 1) },
      uCell: { value: cell },
      uPaper: { value: new Vector3(...paper) },
      uFluid: { value: fluidTexture },
      uFlowScale: { value: 1 },
      uTime: { value: 0 },
      uRippleCentre: { value: new Vector2() },
      uRipple: { value: -RIPPLE_BAND * 2 },
      uRipple2: { value: -RIPPLE_BAND * 2 },
      uRippleBand: { value: RIPPLE_BAND },
      uLoad: { value: 0 },
      uCopy: { value: new Vector4(-1e4, -1e4, -1e4, -1e4) },
    },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const backdropGeometry = new PlaneGeometry(2, 2);
  const backdrop = new Mesh(backdropGeometry, lattice);
  backdrop.frustumCulled = false;
  backdrop.renderOrder = -10;
  scene.add(backdrop);

  // ---- the ring: main's polished metal ----
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
  object.add(...bondGeometry.map((geometry) => new Mesh(geometry, bondMaterial)));
  let lastShape = "";
  scene.add(object);

  // A soft grounding shadow on the paper.
  const shadowTexture = softTexture((u, v) => smooth(clamp01(1 - Math.hypot(u - 0.5, v - 0.5) * 2)) ** 1.5, 128);
  const shadowPlane = new PlaneGeometry(1, 1);
  const shadowMaterial = new MeshBasicMaterial({
    map: shadowTexture,
    color: 0x20242a,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const shadow = new Mesh(shadowPlane, shadowMaterial);
  shadow.position.set(0, -SHADOW.drop, -24);
  scene.add(shadow);

  // Read once per change, never per frame (polling `matches` in a frame swallows changes).
  let ambient = motion.ambient;

  // ---- state ----
  const tiltYaw: Spring = { x: 0, v: 0 };
  const tiltPitch: Spring = { x: 0, v: 0 };
  const tip: Spring = { x: 0, v: 0 };
  let target = { yaw: 0, pitch: 0 };
  let tiltMode: "hover" | "leave" = "leave";
  let tipTarget = 0;
  let clock = 0;
  let rate = ambient ? 1 : 0;
  let sweepAge = SWEEP;
  let width = 0; // CSS px
  let height = 0;
  let resizePending = true;
  let ringCentre = { x: 0, y: 0 };
  let ringRadius = 0;
  // How much of the shadow the canvas can show: a shadow that would run off the bottom of
  // the hero fades out instead of being cut straight across.
  let shadowFit = 1;
  let lost = false;
  let destroyed = false;

  // Arrival: "fading" until the canvas covers the page, then the honeycomb's exit.
  let latticeMode: "ripple" | "quiet" | "none" = "none";
  let loadAge = 0;
  let loadDone = true;
  let loadHeld = false; // dev only: the scrub hook holds the wave still
  let fadeTimer = 0;
  let farthest = 1;

  // Pointer and fluid.
  let pointer: { x: number; y: number; t: number } | undefined;
  let last: { x: number; y: number; t: number } | undefined;
  let pointerMoved = false;
  let fluidDirty = false;

  // Adaptive resolution.
  let ratioCeiling = START_RATIO;
  let deviceCap = 2;
  let framesSinceTimed = 0;
  let timing = false;
  const costs: number[] = [];
  let lastCost = 0;
  let calmWindows = 0;
  let calmNeeded = COST.calmWindows;
  let climbed = false;

  const sizeBuffer = () => {
    if (!width || !height) return;
    deviceCap = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setDrawingBufferSize(width, height, Math.min(deviceCap, ratioCeiling));
  };

  const resize = () => {
    resizePending = false;
    const w = field.clientWidth;
    const h = field.clientHeight;
    const changed = w !== width || h !== height;
    width = w;
    height = h;
    sizeBuffer();
    if (!changed || !width || !height) return;
    lattice.uniforms.uSize!.value.set(width, height);
    // The fluid keeps square cells across the field.
    const rows = Math.max(16, Math.round((FLUID_COLS * height) / width));
    fluid = new Fluid(FLUID_COLS, rows, TRAIL);
    fluidData = new Uint8Array(FLUID_COLS * rows * 4);
    fluidTexture.dispose();
    fluidTexture = new DataTexture(fluidData, FLUID_COLS, rows, RGBAFormat, UnsignedByteType);
    fluidTexture.magFilter = fluidTexture.minFilter = LinearFilter;
    fillFluid();
    lattice.uniforms.uFluid!.value = fluidTexture;
    lattice.uniforms.uFlowScale!.value = (FLOW_SCALE * width) / FLUID_COLS;
    farthest = Math.hypot(Math.max(ringCentre.x, width - ringCentre.x), Math.max(ringCentre.y, height - ringCentre.y));
  };

  // Dye in red; velocity in green and blue around a mid grey.
  const fillFluid = () => {
    const n = fluid.w * fluid.h;
    for (let i = 0; i < n; i++) {
      fluidData[i * 4] = Math.min(255, fluid.dye[i]! * 255);
      fluidData[i * 4 + 1] = Math.max(0, Math.min(255, 128 + (fluid.u[i]! / FLOW_SCALE) * 255));
      fluidData[i * 4 + 2] = Math.max(0, Math.min(255, 128 + (fluid.v[i]! / FLOW_SCALE) * 255));
      fluidData[i * 4 + 3] = 255;
    }
    fluidTexture.needsUpdate = true;
  };

  // Where the layout ring is; the camera is placed so the glass ring lands exactly there.
  const place = (canvasRect: DOMRect) => {
    const box = ring();
    object.visible = shadow.visible = !!box && box.radius > 0;
    if (!box || !object.visible) return;
    ringCentre = { x: box.cx - canvasRect.left, y: box.cy - canvasRect.top };
    ringRadius = box.radius;
    // One mark unit in CSS px at the ring's depth (the ring is R = 100 units).
    const pxPerUnit = box.radius / 100;
    const shadowCentre = ringCentre.y + SHADOW.drop * pxPerUnit;
    const overflow = shadowCentre + (SHADOW.y / 2) * pxPerUnit - height;
    // Gone by the time the canvas edge would cut through the shadow's middle.
    shadowFit = 1 - smooth(clamp01(overflow / ((SHADOW.y / 2) * pxPerUnit)));
    const distance = height / (2 * Math.tan((FOV * DEG) / 2) * pxPerUnit);
    camera.aspect = width / height;
    camera.position.set(0, 0, distance);
    camera.near = Math.max(1, distance - 420);
    camera.far = distance + 420;
    // A lens shift, not a turn: the ring stays square to the lens wherever it sits.
    camera.setViewOffset(width, height, width / 2 - ringCentre.x, height / 2 - ringCentre.y, width, height);
    camera.updateProjectionMatrix();
    // The box around the headline and the form, whatever their layout.
    if (copy.length) {
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      for (const el of copy) {
        const r = el.getBoundingClientRect();
        left = Math.min(left, r.left);
        top = Math.min(top, r.top);
        right = Math.max(right, r.right);
        bottom = Math.max(bottom, r.bottom);
      }
      lattice.uniforms.uCopy!.value.set(left - canvasRect.left, top - canvasRect.top, right - canvasRect.left, bottom - canvasRect.top);
    }
    // Scrolling the hero away tips the ring back, as the metal one did.
    tipTarget = ambient ? -SCROLL_TIP * smooth(clamp01(-canvasRect.top / (canvasRect.height * 0.8))) : 0;
  };

  const stir = (canvasRect: DOMRect) => {
    if (!pointerMoved) return;
    pointerMoved = false;
    if (!pointer) return;
    const x = pointer.x - canvasRect.left;
    const y = pointer.y - canvasRect.top;
    const t = pointer.t;
    // The ring leans toward the cursor wherever it is over the hero.
    const inside = x >= 0 && y >= 0 && x <= width && y <= height;
    if (inside && ambient) {
      target = {
        yaw: Math.max(-1, Math.min(1, (x - ringCentre.x) / (width * 0.5))) * HOVER_TILT,
        pitch: Math.max(-1, Math.min(1, (y - ringCentre.y) / (height * 0.5))) * HOVER_TILT,
      };
      tiltMode = "hover";
    }
    if (!inside || !ambient) {
      last = undefined;
      return;
    }
    const cellPx = width / fluid.w;
    if (last) {
      const dt = Math.max(1 / 240, (t - last.t) / 1000);
      let vx = (x - last.x) / dt;
      let vy = (y - last.y) / dt;
      const speed = Math.hypot(vx, vy);
      if (speed > MAX_POINTER_SPEED) {
        vx *= MAX_POINTER_SPEED / speed;
        vy *= MAX_POINTER_SPEED / speed;
      }
      const dist = Math.hypot(x - last.x, y - last.y);
      if (dist > 0.5) {
        // Splats along the path, so a fast stroke leaves a trail, not a row of blobs.
        const steps = Math.min(10, Math.max(1, Math.ceil(dist / (BRUSH * 0.6))));
        const dye = Math.min(0.35, 0.08 + speed / 3200) / Math.sqrt(steps);
        for (let k = 1; k <= steps; k++) {
          const sx = last.x + ((x - last.x) * k) / steps;
          const sy = last.y + ((y - last.y) * k) / steps;
          fluid.splat(sx / cellPx - 0.5, sy / cellPx - 0.5, (vx / cellPx) * FORCE, (vy / cellPx) * FORCE, BRUSH / cellPx / 2, dye);
        }
      }
    }
    last = { x, y, t };
  };

  const pose = () => {
    const a = Math.sin(Math.min(clock / 1.6, 1) * (Math.PI / 2)) ** 2;
    const t = clock * Math.PI * 2;
    object.position.x = 1.6 * a * Math.sin(t / 9.7);
    object.rotation.z = 1.2 * DEG * a * Math.sin(t / 8.1);
    object.position.y = AMBIENT.lift * a * Math.sin(t / 6.8);
    object.rotation.y = REST.yaw + tiltYaw.x + AMBIENT.yaw * a * Math.sin(t / 11.3);
    object.rotation.x = REST.pitch + tiltPitch.x + tip.x + AMBIENT.pitch * a * Math.sin(t / 8.3);
    const shape = `${feedback.rotation}/${feedback.circle}/${feedback.done}/${feedback.comet}`;
    if (shape !== lastShape) {
      lastShape = shape;
      const points = feedback.points();
      // One depth step apart, so overlapping strokes never flicker.
      bondGeometry.forEach((geometry, i) => geometry.update(points.slice(i * 60, i * 60 + 60), i * 0.03));
    }
    // The studio turns in on arrival, and a little against any tilt, so highlights travel.
    const sweep = smooth(clamp01(sweepAge / SWEEP));
    const follow = (tilt: number) => ENV_FOLLOW.limit * Math.tanh(tilt / ENV_FOLLOW.limit);
    scene.environmentRotation.y = ENV_ARRIVAL * (1 - sweep) + follow(tiltYaw.x) * ENV_FOLLOW.yaw;
    scene.environmentRotation.x = follow(tiltPitch.x) * ENV_FOLLOW.pitch;

    const lift = object.position.y / AMBIENT.lift;
    shadow.position.x = tiltYaw.x * 62 + object.position.x;
    shadow.scale.set(SHADOW.x * (1 + 0.04 * lift), SHADOW.y * (1 + 0.06 * lift + 0.5 * Math.sin(Math.abs(tip.x))), 1);
    shadowMaterial.opacity = SHADOW.alpha * (1 - 0.08 * lift) * shadowFit;
  };

  const stepLattice = (dt: number) => {
    const u = lattice.uniforms;
    if (loadDone) {
      u.uLoad!.value = 0;
      return;
    }
    if (!loadHeld) loadAge += dt;
    if (latticeMode === "quiet") {
      // No waves: the whole honeycomb fades in, holds, and fades out together.
      const up = smooth(clamp01((loadAge - WAVE_HOLD) / QUIET.rise));
      const down = smooth(clamp01((loadAge - WAVE_HOLD - QUIET.rise - QUIET.hold) / QUIET.fall));
      u.uLoad!.value = up * (1 - down);
      u.uRipple!.value = 1e6;
      u.uRipple2!.value = -1e6;
      if (down >= 1) loadDone = true;
      return;
    }
    const reach = farthest + RIPPLE_BAND * 4;
    const raise = inOut(clamp01((loadAge - WAVE_HOLD) / WAVE_IN));
    const flatten = inOut(clamp01((loadAge - WAVE_HOLD - WAVE_IN - WAVE_GAP) / WAVE_OUT));
    u.uLoad!.value = 1;
    u.uRippleCentre!.value.set(ringCentre.x, ringCentre.y);
    u.uRipple!.value = -RIPPLE_BAND * 2 + raise * reach;
    u.uRipple2!.value = -RIPPLE_BAND * 2 + flatten * reach;
    if (flatten >= 1) loadDone = true;
  };

  const step = (dt: number) => {
    const wanted = ambient ? 1 : 0;
    rate = damp(rate, wanted, 3.2, dt);
    if (Math.abs(rate - wanted) < 0.004) rate = wanted;
    clock += dt * rate;
    if (sweepAge < SWEEP) sweepAge += dt;
    lattice.uniforms.uTime!.value = clock;
    stepLattice(dt);
    if (!fluid.idle) {
      fluid.step(dt);
      fluidDirty = true;
    }
    if (fluidDirty) {
      fillFluid();
      fluidDirty = !fluid.idle;
    }
    stepSpring(tiltYaw, target.yaw, TILT[tiltMode][0], TILT[tiltMode][1], dt);
    stepSpring(tiltPitch, target.pitch, TILT[tiltMode][0], TILT[tiltMode][1], dt);
    stepSpring(tip, tipTarget, SCROLL_FOLLOW[0], SCROLL_FOLLOW[1], dt);
  };

  // ---- frame cost ----
  const weighCost = (cost: number) => {
    costs.push(cost);
    if (costs.length < COST.window) return;
    costs.sort((a, b) => a - b);
    lastCost = costs[COST.window >> 1] ?? 0;
    costs.length = 0;
    const current = Math.min(ratioCeiling, deviceCap);
    if (lastCost > COST.slow && current > 1) {
      ratioCeiling = Math.max(1, current - 0.25);
      if (climbed) calmNeeded *= 2;
      climbed = false;
      calmWindows = 0;
      sizeBuffer();
    } else if (lastCost < COST.calm && current < deviceCap && ++calmWindows >= calmNeeded) {
      ratioCeiling = current + 0.25;
      climbed = true;
      calmWindows = 0;
      sizeBuffer();
    } else if (lastCost >= COST.calm) {
      calmWindows = 0;
    }
  };

  // Times the frame's GPU work with a fence polled from timers, never blocking the page.
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
      if (!document.hidden) weighCost(cost);
    };
    setTimeout(poll);
  };

  // ---- lifecycle ----
  const observer = new ResizeObserver(() => {
    resizePending = true;
    wake();
  });
  observer.observe(field);
  const stopDensity = onDensityChange(() => {
    resizePending = true;
    wake();
  });

  const handleLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    environment.dispose();
    onLost();
  };
  canvas.addEventListener("webglcontextlost", handleLost);

  const release = () => {
    destroyed = true;
    clearTimeout(fadeTimer);
    observer.disconnect();
    stopDensity();
    canvas.removeEventListener("webglcontextlost", handleLost);
    ringGeometry.dispose();
    bondGeometry.forEach((geometry) => geometry.dispose());
    bondMaterial.dispose();
    metal.dispose();
    backdropGeometry.dispose();
    lattice.dispose();
    fluidTexture.dispose();
    shadowPlane.dispose();
    shadowMaterial.dispose();
    shadowTexture.dispose();
    environment.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  };

  const render = () => {
    pose();
    renderer.render(scene, camera);
  };

  // Compiled before the first visible frame, off the main thread where the browser can.
  resize();
  place(canvas.getBoundingClientRect());
  await renderer.compileAsync(scene, camera);
  await breathe();
  render();
  if (shaderFailed || gl.isContextLost()) {
    release();
    throw new Error("The hero's materials did not compile.");
  }

  return {
    frame(dt) {
      if (lost || destroyed) return;
      const started = performance.now();
      if (resizePending) resize();
      if (!width || !height) return;
      const canvasRect = canvas.getBoundingClientRect();
      place(canvasRect);
      stir(canvasRect);
      step(dt);
      render();
      timeFrame(started);
    },
    get needsFrame() {
      if (lost || destroyed) return false;
      return (
        resizePending ||
        pointerMoved ||
        !loadDone ||
        sweepAge < SWEEP ||
        ambient ||
        rate > 0 ||
        !fluid.idle ||
        fluidDirty ||
        !atRest(tiltYaw, target.yaw) ||
        !atRest(tiltPitch, target.pitch) ||
        !atRest(tip, tipTarget)
      );
    },
    reveal(mode, shown) {
      latticeMode = mode === "none" ? "none" : ambient ? "ripple" : "quiet";
      loadDone = mode === "none";
      loadAge = 0;
      sweepAge = ambient ? 0 : SWEEP;
      lattice.uniforms.uLoad!.value = loadDone ? 0 : 1;
      lattice.uniforms.uRipple!.value = -RIPPLE_BAND * 2;
      lattice.uniforms.uRipple2!.value = -RIPPLE_BAND * 2;
      lattice.uniforms.uRippleCentre!.value.set(ringCentre.x, ringCentre.y);
      farthest = Math.hypot(Math.max(ringCentre.x, width - ringCentre.x), Math.max(ringCentre.y, height - ringCentre.y));
      render();
      canvas.style.opacity = "1";
      clearTimeout(fadeTimer);
      fadeTimer = window.setTimeout(shown, FADE_MS);
      wake();
    },
    hover(clientX, clientY) {
      pointer = { x: clientX, y: clientY, t: performance.now() };
      pointerMoved = true;
    },
    leave() {
      pointer = undefined;
      last = undefined;
      target = { yaw: 0, pitch: 0 };
      tiltMode = "leave";
      wake();
    },
    motionChanged() {
      ambient = motion.ambient;
      if (!ambient) {
        target = { yaw: 0, pitch: 0 };
        tiltMode = "leave";
        fluid.clear();
        fluidDirty = true;
        last = undefined;
        if (!loadDone && latticeMode === "ripple") latticeMode = "quiet";
      }
      wake();
    },
    destroy: release,
    ...(import.meta.env.DEV
      ? {
          scrub(age: number) {
            loadHeld = age >= 0;
            if (!loadHeld) return;
            latticeMode = "ripple";
            loadDone = false;
            loadAge = age;
            const canvasRect = canvas.getBoundingClientRect();
            place(canvasRect);
            farthest = Math.hypot(Math.max(ringCentre.x, width - ringCentre.x), Math.max(ringCentre.y, height - ringCentre.y));
            step(0);
            render();
          },
        }
      : {}),
    debug: () => ({
      size: [width, height],
      buffer: [canvas.width, canvas.height],
      ratio: Math.min(deviceCap, ratioCeiling),
      frameCost: lastCost,
      ring: { ...ringCentre, radius: ringRadius },
      lattice: {
        mode: latticeMode,
        done: loadDone,
        age: loadAge,
        waves: [lattice.uniforms.uRipple!.value, lattice.uniforms.uRipple2!.value],
      },
      fluid: { idle: fluid.idle, dye: fluid.maxDye, speed: fluid.speed },
      feedback: { rotation: feedback.rotation, done: feedback.done, status: feedback.status },
      calls: renderer.info.render.calls,
    }),
  };
}
