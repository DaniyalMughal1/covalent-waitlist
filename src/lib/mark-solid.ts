// The Covalent mark as a solid, derived from the flat proportions in mark.ts.
//
// Built analytically instead of with ExtrudeGeometry, for two reasons that show up on
// polished metal: ExtrudeGeometry's non-indexed bevels step in reflections, and its bevel
// grows the silhouette. Here every surface is a cross-section swept along the mark's
// centre lines, so each normal is exact and the outermost contour is the mark's own.
//
// A stroke is swept as two halves that meet on the centre line. `h` is the distance out
// from that line: h = stroke / 2 is the silhouette. Outer corners are round joins, so the
// outer half turns about the hexagon's vertex. Inner corners are sharp, so the inner half
// stops at a mitre and its bevels meet in a hard crease, as a machined pocket does.
//
// Units match mark.ts (R = 100), origin at the centre, but y is up and +z faces the viewer.

import { BOND_ANGLES, BOND_HALF, BOND_OFFSET, BOND_STROKE, OUTLINE_STROKE, R } from "./mark";

export interface SolidOptions {
  /** Front to back, in mark units. */
  thickness: number;
  /** Radius of the rounded edge, in mark units. */
  bevel: number;
  /** Degrees the face's normals lean outward at the bevel. Shading only: the face stays flat. */
  crown: number;
  /** Degrees the wall's normals lean toward each bevel. Shading only, as with the crown. */
  wallLean: number;
  bevelSegments: number;
  /** Segments in each 60° round join. */
  cornerSegments: number;
  /** Segments in each 180° bond cap. */
  capSegments: number;
}

export const SOLID_DEFAULTS: SolidOptions = {
  thickness: 14,
  bevel: 3,
  crown: 3.5,
  wallLean: 6,
  bevelSegments: 7,
  cornerSegments: 12,
  capSegments: 24,
};

export interface Solid {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array;
}

const DEG = Math.PI / 180;
const APOTHEM = (R * Math.sqrt(3)) / 2;

type Vec2 = readonly [number, number];
const direction = (deg: number): Vec2 => [Math.cos(deg * DEG), Math.sin(deg * DEG)];

/** One row of the cross-section. `radial` and `axial` are the normal in the (u, z) plane. */
export interface Row {
  h: number;
  z: number;
  radial: number;
  axial: number;
}

/** One position along a centre line. A row lands at `from + h * across`; its normal uses `outward`. */
interface Station {
  from: Vec2;
  across: Vec2;
  outward: Vec2;
}

// Front centre line, over the bevel and down the wall, back to the rear centre line.
export function crossSection(halfStroke: number, o: SolidOptions): Row[] {
  const crown = o.crown * DEG;
  const curveH = halfStroke - o.bevel;
  const curveZ = o.thickness / 2 - o.bevel;

  // The face ends where the bevel's normal already matches the crown's lean, so the
  // reflection runs from one to the other without a seam.
  const edgeH = curveH + o.bevel * Math.sin(crown);
  const faceZ = curveZ + o.bevel * Math.cos(crown);

  const rows: Row[] = [];
  for (const t of [0, 0.55, 1]) {
    const lean = crown * t ** 1.35; // flatter in the middle, so the crown reads near the edge
    rows.push({ h: edgeH * t, z: faceZ, radial: Math.sin(lean), axial: Math.cos(lean) });
  }

  // A truly flat wall has one normal, so it reflects one point of the room: a band of solid
  // tone that reads as a vector extrude. The bevels hand over to the wall a little early, and
  // the wall's own normals run between those two leans, so it reflects a span of the room and
  // shades from front to back. The position still follows the true quarter circle.
  const wall = o.wallLean * DEG;
  const arc = Math.PI / 2 - crown;
  for (let i = 1; i <= o.bevelSegments; i++) {
    const t = 1 - i / o.bevelSegments;
    const a = arc * t;
    const n = wall + (arc - wall) * t;
    rows.push({ h: curveH + o.bevel * Math.cos(a), z: curveZ + o.bevel * Math.sin(a), radial: Math.cos(n), axial: Math.sin(n) });
  }

  for (let i = 0; i <= o.bevelSegments; i++) {
    const t = i / o.bevelSegments;
    const a = (-Math.PI / 2) * t;
    const n = -wall - (Math.PI / 2 - wall) * t;
    rows.push({ h: curveH + o.bevel * Math.cos(a), z: -curveZ + o.bevel * Math.sin(a), radial: Math.cos(n), axial: Math.sin(n) });
  }

  rows.push({ h: 0, z: -o.thickness / 2, radial: 0, axial: -1 });
  return rows;
}

class Builder {
  private positions: number[] = [];
  private normals: number[] = [];
  private indices: number[] = [];

  private triangle(a: number, b: number, c: number) {
    const p = this.positions;
    const ux = p[b * 3]! - p[a * 3]!;
    const uy = p[b * 3 + 1]! - p[a * 3 + 1]!;
    const uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
    const vx = p[c * 3]! - p[a * 3]!;
    const vy = p[c * 3 + 1]! - p[a * 3 + 1]!;
    const vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    // Where a round join collapses onto its vertex the quad has no area on one side.
    if (nx * nx + ny * ny + nz * nz > 1e-12) this.indices.push(a, b, c);
  }

  sweep(stations: readonly Station[], rows: readonly Row[], closed: boolean) {
    const base = this.positions.length / 3;
    const across = rows.length;
    for (const { from, across: step, outward } of stations) {
      for (const { h, z, radial, axial } of rows) {
        this.positions.push(from[0] + h * step[0], from[1] + h * step[1], z);
        this.normals.push(outward[0] * radial, outward[1] * radial, axial);
      }
    }
    const spans = closed ? stations.length : stations.length - 1;
    for (let j = 0; j < spans; j++) {
      const next = (j + 1) % stations.length;
      for (let k = 0; k < across - 1; k++) {
        const a = base + j * across + k;
        const b = base + next * across + k;
        this.triangle(a, a + 1, b);
        this.triangle(b, a + 1, b + 1);
      }
    }
  }

  finish(): Solid {
    return {
      positions: Float32Array.from(this.positions),
      normals: Float32Array.from(this.normals),
      indices: Uint16Array.from(this.indices),
    };
  }
}

/** The hexagonal outline, flat top and bottom, with round outer joins and sharp inner corners. */
export function buildRing(options: Partial<SolidOptions> = {}): Solid {
  const o = { ...SOLID_DEFAULTS, ...options };
  const rows = crossSection(OUTLINE_STROKE / 2, o);
  const vertices = [0, 1, 2, 3, 4, 5].map((i) => direction(60 * i)).map(([x, y]) => [x * R, y * R] as const);
  const builder = new Builder();

  // Outer half, anticlockwise, turning about each vertex through its round join.
  const outer: Station[] = [];
  vertices.forEach((vertex, i) => {
    const next = vertices[(i + 1) % 6]!;
    const normal = 30 + 60 * i;
    const out = direction(normal);
    outer.push({ from: vertex, across: out, outward: out }, { from: next, across: out, outward: out });
    for (let k = 1; k < o.cornerSegments; k++) {
      const turned = direction(normal + (60 * k) / o.cornerSegments);
      outer.push({ from: next, across: turned, outward: turned });
    }
  });
  builder.sweep(outer, rows, true);

  // Inner half, one run per edge, so each side of the mitre keeps its own exact normal.
  // Going inward by h scales the hexagon about the centre, which is what keeps the corner on the mitre.
  vertices.forEach((vertex, i) => {
    const next = vertices[(i + 1) % 6]!;
    const [nx, ny] = direction(30 + 60 * i);
    const inward = [-nx, -ny] as const;
    const toCentre = (v: Vec2): Vec2 => [-v[0] / APOTHEM, -v[1] / APOTHEM];
    builder.sweep(
      [
        { from: next, across: toCentre(next), outward: inward },
        { from: vertex, across: toCentre(vertex), outward: inward },
      ],
      rows,
      false,
    );
  });

  return builder.finish();
}

/** The three inner bonds at rest, as one solid, since they always turn together. */
export function buildBonds(options: Partial<SolidOptions> = {}): Solid {
  const o = { ...SOLID_DEFAULTS, ...options };
  const rows = crossSection(BOND_STROKE / 2, o);
  const builder = new Builder();

  for (const angle of BOND_ANGLES) {
    // mark.ts measures y down, so a centre direction of 270° is the top bond here.
    const [ax, ay] = direction(-angle);
    const centre: Vec2 = [ax * BOND_OFFSET, ay * BOND_OFFSET];
    const along: Vec2 = [ay, -ax];
    const place = (x: number): Vec2 => [centre[0] + along[0] * x, centre[1] + along[1] * x];
    const turn = (deg: number): Vec2 => {
      const [c, s] = direction(deg);
      return [along[0] * c - along[1] * s, along[0] * s + along[1] * c];
    };

    // Anticlockwise round the capsule: one long side, a cap, the other side, the other cap.
    const stations: Station[] = [];
    const caps: readonly [number, number][] = [
      [-BOND_HALF, 180],
      [BOND_HALF, 0],
    ];
    caps.forEach(([x, start], c) => {
      for (let k = 0; k < o.capSegments; k++) {
        const out = turn(start - 90 + (180 * k) / o.capSegments);
        stations.push({ from: place(x), across: out, outward: out });
      }
      const end = turn(start + 90);
      stations.push({ from: place(x), across: end, outward: end });
      const [nextX] = caps[(c + 1) % 2]!;
      stations.push({ from: place(nextX), across: end, outward: end });
    });

    // The side that leaves each cap is the last pair above; drop the duplicate closing rows.
    builder.sweep(stations.filter((_, i) => (i + 1) % (o.capSegments + 2) !== 0), rows, true);
  }

  return builder.finish();
}
