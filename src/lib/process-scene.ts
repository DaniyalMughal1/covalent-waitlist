// Isometric geometry for the process scene. Everything is generated from world
// coordinates through one projector, so perspective and thickness cannot drift apart.
//
// World axes: x runs down-right on screen, y runs down-left, z runs straight up. The
// shared plane's top is z = 0. Agent plates are built around their own origin (centre
// of the underside) and moved by the timeline, so one set of paths serves every beat.

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 2:1 dimetric. Affine, so a Bézier in world space stays an exact Bézier on screen. */
export function project(x: number, y: number, z = 0): Vec2 {
  return [x - y, (x + y) / 2 - z];
}

const num = (n: number) => String(Math.round(n * 100) / 100);
const pair = ([x, y]: Vec2) => `${num(x)} ${num(y)}`;

/* ---------- runs of world-space segments, drawable at any height ---------- */

interface Cmd {
  c?: readonly [Vec2, Vec2];
  to: Vec2;
}
interface Run {
  from: Vec2;
  cmds: Cmd[];
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const on = ([cx, cy]: Vec2, r: number, deg: number): Vec2 => [cx + r * Math.cos(rad(deg)), cy + r * Math.sin(rad(deg))];

function arc(centre: Vec2, r: number, from: number, to: number): Cmd {
  const a0 = rad(from);
  const a1 = rad(to);
  const k = (4 / 3) * Math.tan((a1 - a0) / 4) * r;
  const p0 = on(centre, r, from);
  const p1 = on(centre, r, to);
  return {
    c: [
      [p0[0] - k * Math.sin(a0), p0[1] + k * Math.cos(a0)],
      [p1[0] + k * Math.sin(a1), p1[1] - k * Math.cos(a1)],
    ],
    to: p1,
  };
}

function runPath(run: Run, z: number, start: "M" | "L" = "M") {
  const at = ([x, y]: Vec2) => pair(project(x, y, z));
  let d = `${start}${at(run.from)}`;
  for (const { c, to } of run.cmds) {
    d += c ? `C${at(c[0])} ${at(c[1])} ${at(to)}` : `L${at(to)}`;
  }
  return d;
}

function reversed(run: Run): Run {
  const stops = [run.from, ...run.cmds.map((cmd) => cmd.to)];
  const cmds = [...run.cmds].reverse().map((cmd, i) => {
    const to = stops[stops.length - 2 - i]!;
    return cmd.c ? { c: [cmd.c[1], cmd.c[0]] as const, to } : { to };
  });
  return { from: stops[stops.length - 1]!, cmds };
}

/** A wall hanging from a run: its top edge at z, its foot at z - height. */
function wall(run: Run, z: number, height: number) {
  return `${runPath(run, z)}${runPath(reversed(run), z - height, "L")}Z`;
}

// A corner's centre plus the angle (deg) at which its arc begins, in the order the
// outline visits them. Each arc turns 90°. The silhouette leaves the top face exactly at
// the middle of the left and right corners, which is why the walls split at 135° and 315°.
function corners({ x0, y0, x1, y1 }: Box, r: number) {
  return {
    front: [x1 - r, y1 - r],
    left: [x0 + r, y1 - r],
    back: [x0 + r, y0 + r],
    right: [x1 - r, y0 + r],
  } satisfies Record<string, Vec2>;
}

function outlineRun(box: Box, r: number): Run {
  const c = corners(box, r);
  const cmds: Cmd[] = [
    arc(c.front, r, 0, 90),
    { to: on(c.left, r, 90) },
    arc(c.left, r, 90, 180),
    { to: on(c.back, r, 180) },
    arc(c.back, r, 180, 270),
    { to: on(c.right, r, 270) },
    arc(c.right, r, 270, 360),
    { to: on(c.front, r, 0) },
  ];
  return { from: on(c.front, r, 0), cmds };
}

function leftWallRun(box: Box, r: number): Run {
  const c = corners(box, r);
  return {
    from: on(c.left, r, 135),
    cmds: [arc(c.left, r, 135, 90), { to: on(c.front, r, 90) }, arc(c.front, r, 90, 45)],
  };
}

function rightWallRun(box: Box, r: number): Run {
  const c = corners(box, r);
  return {
    from: on(c.front, r, 45),
    cmds: [arc(c.front, r, 45, 0), { to: on(c.right, r, 360) }, arc(c.right, r, 360, 315)],
  };
}

function join(a: Run, b: Run): Run {
  return { from: a.from, cmds: [...a.cmds, ...b.cmds] };
}

const shrink = ({ x0, y0, x1, y1 }: Box, by: number): Box => ({ x0: x0 + by, y0: y0 + by, x1: x1 - by, y1: y1 - by });

export function boundsOf(points: readonly Vec2[], pad = 0): Bounds {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}

export function unionBounds(...items: readonly Bounds[]): Bounds {
  return boundsOf(items.flatMap((b) => [[b.x, b.y] as const, [b.x + b.w, b.y + b.h] as const]));
}

export const viewBoxOf = ({ x, y, w, h }: Bounds) => `${num(x)} ${num(y)} ${num(w)} ${num(h)}`;

/* ---------- a plate ---------- */

export interface PlateOptions {
  box: Box;
  /** World height of the top face. */
  top: number;
  thickness: number;
  radius: number;
  /** Distance of the fine outline printed on the top face. */
  inset: number;
  /** Height of the ownership band under the top edge; 0 for none. */
  band?: number;
  /** World positions of side ribs, measured from each wall's far end. */
  ribs?: readonly number[];
}

export interface Plate {
  top: string;
  wallLeft: string;
  wallRight: string;
  /** The front top edges, for the fine highlight and the outline stroke. */
  edge: string;
  bandLeft: string;
  bandRight: string;
  inset: string;
  ribs: string;
  bounds: Bounds;
}

export function plate({ box, top, thickness, radius, inset, band = 0, ribs = [] }: PlateOptions): Plate {
  const leftRun = leftWallRun(box, radius);
  const rightRun = rightWallRun(box, radius);
  const margin = Math.min(3, thickness * 0.14);
  const ribFoot = top - thickness + margin;

  // Ribs start below the ownership band so the two details never collide.
  const ribTop = top - band - margin;
  const rib = (x: number, y: number) =>
    `M${pair(project(x, y, ribTop))}L${pair(project(x, y, ribFoot))}`;
  const ribPaths = ribs.flatMap((d) => [rib(box.x0 + radius + d, box.y1), rib(box.x1, box.y0 + radius + d)]);

  return {
    top: `${runPath(outlineRun(box, radius), top)}Z`,
    wallLeft: wall(leftRun, top, thickness),
    wallRight: wall(rightRun, top, thickness),
    edge: runPath(join(leftRun, rightRun), top),
    bandLeft: band ? wall(leftRun, top, band) : "",
    bandRight: band ? wall(rightRun, top, band) : "",
    inset: `${runPath(outlineRun(shrink(box, inset), Math.max(radius - inset, 2)), top)}Z`,
    ribs: ribPaths.join(""),
    bounds: boundsOf(
      [
        project(box.x0, box.y0, top),
        project(box.x1, box.y0, top),
        project(box.x0, box.y1, top),
        project(box.x1, box.y1, top - thickness),
        project(box.x1, box.y0, top - thickness),
        project(box.x0, box.y1, top - thickness),
      ],
      2,
    ),
  };
}

/* ---------- printing flat on a plane ---------- */

/**
 * Lays a sheet on a horizontal plane. Sheet x (reading direction) rises to the right
 * along world -y; sheet y runs along world +x. Stroke and glyph shapes are sheared with
 * it, so type and the mark are printed in the same projection as the plate they sit on.
 */
export function sheetMatrix(x: number, y: number, z = 0, scale = 1) {
  const [e, f] = project(x, y, z);
  return `matrix(${num(scale)} ${num(-scale / 2)} ${num(scale)} ${num(scale / 2)} ${num(e)} ${num(f)})`;
}

/** The world point at sheet position (u, v) of a sheet with its origin at (x, y). */
export const onSheet = (x: number, y: number, u: number, v: number): Vec2 => [x + v, y - u];

/* ---------- world layout: the one source for scene and timeline ---------- */

/** The scene's frame on screen. Ground corners deliberately overrun it toward the edge. */
export const SCENE_VIEW: Bounds = { x: -484, y: -408, w: 1064, h: 788 };

export const SHARED_BOX: Box = { x0: -318, y0: -214, x1: 318, y1: 62 };
export const SHARED_THICKNESS = 18;
export const GROUND_BOX: Box = { x0: -338, y0: -238, x1: 338, y1: 252 };
export const GROUND_TOP = -74;
export const GROUND_THICKNESS = 10;

export const AGENT_HALF = 72;
export const AGENT_THICKNESS = 34;
export const AGENT_RADIUS = 14;
const AGENT_BOX: Box = { x0: -AGENT_HALF, y0: -AGENT_HALF, x1: AGENT_HALF, y1: AGENT_HALF };
export const OWNERSHIP_BAND = 7;

/**
 * Where the plate centres stand in each held beat. Rest and claim mirror about x = 0;
 * the dock is on the ground, in front of the shared plane, so the printed brief can
 * never be covered by the returning pair.
 */
export const POSE = {
  rest: { x: 172, y: -76, z: 8 },
  claim: { x: 236, y: -76, z: 94 },
  dock: { ui: { x: -34, y: 146, z: GROUND_TOP }, api: { x: 114, y: 146, z: GROUND_TOP } },
} as const;

/** Sheet origin of the printed brief. */
export const PRINT = { x: -74, y: 42 } as const;

export const TOKEN_HALF = { x: 34, y: 21 } as const;
export const TOKEN_THICKNESS = 9;
/**
 * Where the token sits on a plate's top, relative to the plate centre. Each spot is a
 * printed seat clear of that plate's glyph, so the token never lands on a drawing.
 */
export const TOKEN_OFFSET = { api: -22, ui: 22 } as const;
/** The token's leader. Tall enough to clear both plates' outlines and the API name. */
export const TOKEN_MAST = 118;

/* ---------- the handoff curve ---------- */

// The hump stays low and central because the projection already carries the line upward
// toward the UI plate: a higher one would send the token's label over the top of the scene.
export const HANDOFF_RISE = 90;
const HANDOFF_SPREAD = 0.35;
/** How far a filename tab stands out of the plate's wall. */
export const TAB_REACH = 58;

function handoffControls(): readonly [Vec3, Vec3, Vec3, Vec3] {
  // The line lies on the plate tops, seat to seat, and the token rides on it.
  const { x, y, z } = POSE.claim;
  const top = z + AGENT_THICKNESS;
  const start = x + TOKEN_OFFSET.api;
  const end = -x + TOKEN_OFFSET.ui;
  const lift = top + HANDOFF_RISE;
  return [
    [start, y, top],
    [start * HANDOFF_SPREAD, y, lift],
    [end * HANDOFF_SPREAD, y, lift],
    [end, y, top],
  ];
}

function bezier([a, b, c, d]: readonly [Vec3, Vec3, Vec3, Vec3], t: number): Vec3 {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const;
  const axis = (i: 0 | 1 | 2) => w[0] * a[i] + w[1] * b[i] + w[2] * c[i] + w[3] * d[i];
  return [axis(0), axis(1), axis(2)];
}

// Arc-length table in projected space, so the drawn stroke and the token share one
// parameter and the token can never sit off the end of the line.
const SAMPLES = 96;
let table: { points: Vec3[]; lengths: number[]; total: number } | undefined;

function curveTable() {
  if (table) return table;
  const controls = handoffControls();
  const points: Vec3[] = [];
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i <= SAMPLES; i += 1) {
    const point = bezier(controls, i / SAMPLES);
    const prev = points[i - 1];
    if (prev) {
      const [ax, ay] = project(...prev);
      const [bx, by] = project(...point);
      total += Math.hypot(bx - ax, by - ay);
    }
    points.push(point);
    lengths.push(total);
  }
  table = { points, lengths, total };
  return table;
}

export const handoffLength = () => curveTable().total;

/** World point at fraction f of the curve's on-screen length, API end to UI end. */
export function handoffPoint(f: number): Vec3 {
  const { points, lengths, total } = curveTable();
  const goal = Math.min(Math.max(f, 0), 1) * total;
  let i = 1;
  while (i < SAMPLES && lengths[i]! < goal) i += 1;
  const span = lengths[i]! - lengths[i - 1]!;
  const t = span > 0 ? (goal - lengths[i - 1]!) / span : 0;
  const a = points[i - 1]!;
  const b = points[i]!;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/* ---------- the whole scene, for the Astro frontmatter ---------- */

const RIBS = [14, 19, 24, 29, 34, 39, 44, 80] as const;
const RIBS_SHARED = [22, 28, 34, 40, 46, 52, 58, 64, 70, 76, 148] as const;

/** Hand-placed brief print, in sheet units, so type and mark stay a single composition. */
export const PRINT_LAYOUT = {
  markR: 42,
  markU: 46,
  markV: 56,
  textU: 104,
  titleV: [31, 60] as const,
  decisionV: [86, 104] as const,
} as const;

/**
 * The reading lines. Each starts at sheet position `u`, in the strip of open plane between
 * the words and the resting plate, and travels `chord` on screen with a shallow `bow`.
 */
const READ = { u: 170, above: -6, below: 122, chord: [100, 50], bow: 22 } as const;

function agentBits() {
  // The glyphs are printed in the plate's own plane so nothing reads as a sticker. Each
  // keeps to the half of its plate that the token's seat leaves free.
  return {
    uiMatrix: sheetMatrix(-58, 30, AGENT_THICKNESS),
    apiMatrix: sheetMatrix(20, 30, AGENT_THICKNESS),
    field: `M4 0H56a4 4 0 0 1 4 4V10a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4Z`,
    button: `M0 21H30V33H0Z`,
    lines: `M0 2H38M0 13H50M0 24H28M0 35H42`,
  };
}

export function buildScene() {
  const ground = plate({
    box: GROUND_BOX,
    top: GROUND_TOP,
    thickness: GROUND_THICKNESS,
    radius: 20,
    inset: 18,
    ribs: [20, 26, 32, 38, 44, 50],
  });
  const shared = plate({
    box: SHARED_BOX,
    top: 0,
    thickness: SHARED_THICKNESS,
    radius: 18,
    inset: 13,
    ribs: RIBS_SHARED,
  });
  const agent = plate({
    box: AGENT_BOX,
    top: AGENT_THICKNESS,
    thickness: AGENT_THICKNESS,
    radius: AGENT_RADIUS,
    inset: 12,
    band: OWNERSHIP_BAND,
    ribs: RIBS,
  });
  const token = plate({
    box: { x0: -TOKEN_HALF.x, y0: -TOKEN_HALF.y, x1: TOKEN_HALF.x, y1: TOKEN_HALF.y },
    top: TOKEN_THICKNESS,
    thickness: TOKEN_THICKNESS,
    radius: 5,
    inset: 5,
  });

  // A filename tab slides out of each plate, UI toward the near left, API toward the far
  // right, so both end in clear field instead of over the shared plane.
  const tabZ = AGENT_THICKNESS * 0.66;
  const tabPlate = (y0: number, y1: number) =>
    plate({ box: { x0: -33, y0, x1: 33, y1 }, top: tabZ, thickness: 8, radius: 6, inset: 5, band: 3 });
  const tabs = {
    ui: tabPlate(AGENT_HALF - 40, AGENT_HALF + TAB_REACH),
    api: tabPlate(-AGENT_HALF - TAB_REACH, -AGENT_HALF + 40),
  };
  // Their outermost corners on screen, where each file name attaches.
  const tabTips = {
    ui: project(-33, AGENT_HALF + TAB_REACH, tabZ),
    api: project(-33, -AGENT_HALF - TAB_REACH, tabZ),
  };

  // The seats the handoff runs between, printed in each plate's ownership colour.
  const seat = (offset: number) =>
    `${runPath(outlineRun({ x0: offset - TOKEN_HALF.x - 4, y0: -TOKEN_HALF.y - 4, x1: offset + TOKEN_HALF.x + 4, y1: TOKEN_HALF.y + 4 }, 8), AGENT_THICKNESS)}Z`;
  const seats = { ui: seat(TOKEN_OFFSET.ui), api: seat(TOKEN_OFFSET.api) };

  // Footprints under the claim pose. They stay on the plane for the rest of the story.
  const { x: cx, y: cy } = POSE.claim;
  const footBox = (side: number): Box => ({
    x0: side * cx - AGENT_HALF - 4,
    y0: cy - AGENT_HALF - 4,
    x1: side * cx + AGENT_HALF + 4,
    y1: cy + AGENT_HALF + 4,
  });
  const footprint = (side: number) =>
    plate({ box: footBox(side), top: 0, thickness: 0, radius: AGENT_RADIUS + 3, inset: 9 });

  // Two lines rise from either side of the brief's words, one to each plate. They are the
  // same arc, mirrored through the brief, so the pair reads as one gesture: both agents
  // read the same thing. Landing points are chosen for that, not at the plate centres.
  const rise = (side: -1 | 1) => {
    const [sx, sy] = onSheet(PRINT.x, PRINT.y, READ.u, side < 0 ? READ.above : READ.below);
    const a = project(sx, sy);
    const [cx, cy] = READ.chord;
    const point = (t: number, up: number): Vec2 => [a[0] + side * cx * t, a[1] + side * cy * t - up];
    const d = point(1, 0);
    return { d: `M${pair(a)}C${pair(point(0.32, READ.bow))} ${pair(point(0.72, READ.bow))} ${pair(d)}`, from: a, tip: d };
  };
  const reads = { ui: rise(-1), api: rise(1) };

  const controls = handoffControls().map((point) => project(...point));
  const handoffD = `M${pair(controls[0]!)}C${pair(controls[1]!)} ${pair(controls[2]!)} ${pair(controls[3]!)}`;

  // The review frame: corner brackets printed on the base around the docked pair. The
  // back margins are wider because the plates' raised tops overlap the base behind them.
  const frame: Box = {
    x0: POSE.dock.ui.x - AGENT_HALF - 40,
    x1: POSE.dock.api.x + AGENT_HALF + 16,
    y0: POSE.dock.ui.y - AGENT_HALF - 40,
    y1: POSE.dock.ui.y + AGENT_HALF + 16,
  };
  const frameZ = GROUND_TOP;
  const arm = 54;
  const corner = (x: number, y: number, dx: number, dy: number) =>
    `M${pair(project(x + dx * arm, y, frameZ))}L${pair(project(x, y, frameZ))}L${pair(project(x, y + dy * arm, frameZ))}`;
  // The leader drops straight down past the base's front edge, into clear field.
  const reviewFrom = project(frame.x1, frame.y1, frameZ);
  const reviewLeader = { from: reviewFrom, to: [reviewFrom[0], reviewFrom[1] + 46] as Vec2 };
  const bracket =
    corner(frame.x0, frame.y0, 1, 1) +
    corner(frame.x1, frame.y0, -1, 1) +
    corner(frame.x1, frame.y1, -1, -1) +
    corner(frame.x0, frame.y1, 1, -1) +
    `M${pair(reviewLeader.from)}L${pair(reviewLeader.to)}`;

  // Thin drop lines tie each lifted plate to its footprint at the visible corners. The
  // middle one is kept apart: a small scene's file name sits on the footprint in its way.
  const tether = (side: number) => {
    const r = AGENT_HALF - AGENT_RADIUS * 0.3;
    const drop = (x: number, y: number) => `M${pair(project(x, y, POSE.claim.z))}L${pair(project(x, y, 0))}`;
    return {
      sides: drop(side * cx - r, cy + r) + drop(side * cx + r, cy - r),
      middle: drop(side * cx + r, cy + r),
    };
  };

  return {
    ground,
    shared,
    agent,
    token,
    tabs,
    tabTips,
    seats,
    bits: agentBits(),
    footprints: { ui: footprint(-1), api: footprint(1) },
    reads,
    tethers: { ui: tether(-1), api: tether(1) },
    handoffD,
    bracket,
    reviewLeader,
    frame,
    frameZ,
  };
}
