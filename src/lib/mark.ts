// Geometry of the Covalent mark: a regular hexagon with flat top and bottom edges and
// three inner bonds on alternating edges (the Kekulé form in Harness's ring.ts).
//
// Units are the outline's circumradius R = 100, origin at the centre, y down. The
// proportions were measured from the supplied flat mark (covalent-flat-mark.png):
// outline stroke ≈ 0.15R, bonds 0.58R from the centre, bond half-length ≈ 0.255R,
// bond stroke ≈ 0.94 × the outline stroke.
//
// STUDY: this is a source-informed reconstruction, not the approved master vector.
// Replace these values (or the whole module) when the approved logo vector arrives.

export const MARK_STUDY = true;

export const R = 100;
export const OUTLINE_STROKE = 15;
export const BOND_STROKE = 14;
export const BOND_OFFSET = 58;
export const BOND_HALF = 25.5;

const SQ3_2 = Math.sqrt(3) / 2;
const round = (n: number) => Math.round(n * 100) / 100;

export type Point = readonly [number, number];

// Vertices clockwise from the top-left, as the terminal intro draws them.
export const VERTICES: readonly Point[] = [
  [-R / 2, -R * SQ3_2],
  [R / 2, -R * SQ3_2],
  [R, 0],
  [R / 2, R * SQ3_2],
  [-R / 2, R * SQ3_2],
  [-R, 0],
].map(([x, y]) => [round(x!), round(y!)] as const);

export const OUTLINE_PATH =
  `M${VERTICES.map(([x, y]) => `${x} ${y}`).join("L")}Z`;

// Exact viewBox that contains the stroked outline with round joins.
const PAD = OUTLINE_STROKE / 2 + 0.5;
export const VIEWBOX = {
  x: -(R + PAD),
  y: -(R * SQ3_2 + PAD),
  w: 2 * (R + PAD),
  h: 2 * (R * SQ3_2 + PAD),
};
export const VIEWBOX_ATTR = `${round(VIEWBOX.x)} ${round(VIEWBOX.y)} ${round(VIEWBOX.w)} ${round(VIEWBOX.h)}`;
export const ASPECT = VIEWBOX.w / VIEWBOX.h;

const rotate = ([x, y]: Point, deg: number): Point => {
  const a = (deg * Math.PI) / 180;
  return [round(x * Math.cos(a) - y * Math.sin(a)), round(x * Math.sin(a) + y * Math.cos(a))];
};

// Bond rest angles, as centre directions (deg, y down): top, lower right, lower left.
export const BOND_ANGLES = [270, 30, 150] as const;

// Each bond is a cubic so it can morph into an arc of the aromatic circle.
export function bondLine(index: number): string {
  const turn = index * 120;
  const a = rotate([-BOND_HALF, -BOND_OFFSET], turn);
  const b = rotate([BOND_HALF, -BOND_OFFSET], turn);
  const c1 = [round(a[0] + (b[0] - a[0]) / 3), round(a[1] + (b[1] - a[1]) / 3)];
  const c2 = [round(a[0] + (2 * (b[0] - a[0])) / 3), round(a[1] + (2 * (b[1] - a[1])) / 3)];
  return `M${a[0]} ${a[1]}C${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${b[0]} ${b[1]}`;
}

// The same bond as a 112° arc of the circle the bonds swing into while working.
export const RING_RADIUS = 52;
export function bondArc(index: number): string {
  const span = 112;
  const mid = BOND_ANGLES[0] + index * 120;
  const t0 = ((mid - span / 2) * Math.PI) / 180;
  const t1 = ((mid + span / 2) * Math.PI) / 180;
  const k = (4 / 3) * Math.tan(((span / 2) * Math.PI) / 180 / 2) * RING_RADIUS;
  const p0 = [RING_RADIUS * Math.cos(t0), RING_RADIUS * Math.sin(t0)];
  const p1 = [RING_RADIUS * Math.cos(t1), RING_RADIUS * Math.sin(t1)];
  const c1 = [p0[0]! - k * Math.sin(t0), p0[1]! + k * Math.cos(t0)];
  const c2 = [p1[0]! + k * Math.sin(t1), p1[1]! - k * Math.cos(t1)];
  const f = (p: number[]) => `${round(p[0]!)} ${round(p[1]!)}`;
  return `M${f(p0)}C${f(c1)} ${f(c2)} ${f(p1)}`;
}

export const BONDS = [0, 1, 2].map(bondLine);
export const ARCS = [0, 1, 2].map(bondArc);

// The ✓ the bonds settle into when work is done (from ring.ts, in units of the bond
// offset), as two strokes.
const S = BOND_OFFSET * 1.02;
export const CHECK_PATH = `M${round(-0.52 * S)} ${round(0.02 * S)}L${round(-0.15 * S)} ${round(0.4 * S)}L${round(0.56 * S)} ${round(-0.42 * S)}`;
