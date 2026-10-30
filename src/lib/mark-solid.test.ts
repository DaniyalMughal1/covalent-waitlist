import { describe, expect, it } from "vitest";
import { BOND_HALF, BOND_OFFSET, BOND_STROKE, OUTLINE_STROKE, R, VIEWBOX } from "./mark";
import { buildBonds, buildRing, SOLID_DEFAULTS, type Solid } from "./mark-solid";

const ring = buildRing();
const bonds = buildBonds();
const SQ3 = Math.sqrt(3);
const APOTHEM = (R * SQ3) / 2;

const vertexOf = (solid: Solid, i: number) => [solid.positions[i * 3]!, solid.positions[i * 3 + 1]!, solid.positions[i * 3 + 2]!] as const;
const normalOf = (solid: Solid, i: number) => [solid.normals[i * 3]!, solid.normals[i * 3 + 1]!, solid.normals[i * 3 + 2]!] as const;
const count = (solid: Solid) => solid.positions.length / 3;

function bounds(solid: Solid) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < count(solid); i++) {
    const [px, py, pz] = vertexOf(solid, i);
    x = Math.max(x, Math.abs(px));
    y = Math.max(y, Math.abs(py));
    z = Math.max(z, Math.abs(pz));
  }
  return { x, y, z };
}

// Area the front of the solid covers when looked at straight on: the silhouette's area.
function frontArea(solid: Solid) {
  let area = 0;
  for (let t = 0; t < solid.indices.length; t += 3) {
    const [ax, ay] = vertexOf(solid, solid.indices[t]!);
    const [bx, by] = vertexOf(solid, solid.indices[t + 1]!);
    const [cx, cy] = vertexOf(solid, solid.indices[t + 2]!);
    const signed = ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
    if (signed > 0) area += signed;
  }
  return area;
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

describe("silhouette", () => {
  it("matches the extents of the stroked outline in mark.ts", () => {
    const { x, y } = bounds(ring);
    // The viewBox is the stroked outline plus half a unit of padding on each side.
    expect(x).toBeCloseTo(-VIEWBOX.x - 0.5, 3);
    expect(y).toBeCloseTo(-VIEWBOX.y - 0.5, 1);
    expect(x).toBeCloseTo(R + OUTLINE_STROKE / 2, 3);
    expect(y).toBeCloseTo(APOTHEM + OUTLINE_STROKE / 2, 3);
  });

  it("covers exactly the area of a stroked hexagon with round outer joins and sharp inner corners", () => {
    const half = OUTLINE_STROKE / 2;
    const hexagon = (apothem: number) => 2 * SQ3 * apothem * apothem;
    const outer = hexagon(APOTHEM) + 6 * R * half + Math.PI * half * half;
    const inner = hexagon(APOTHEM - half);
    expect(frontArea(ring)).toBeCloseTo(outer - inner, 0);
  });

  it("never lets the bevel outside the stroke", () => {
    const corners = [0, 1, 2, 3, 4, 5].map((i) => [R * Math.cos((i * Math.PI) / 3), R * Math.sin((i * Math.PI) / 3)] as const);
    for (let i = 0; i < count(ring); i++) {
      const [x, y] = vertexOf(ring, i);
      const distance = Math.min(...corners.map((a, k) => {
        const b = corners[(k + 1) % 6]!;
        return distanceToSegment(x, y, a[0], a[1], b[0], b[1]);
      }));
      // The inner corner's mitre is further from the line than the stroke, by 1 / cos 30°.
      expect(distance).toBeLessThanOrEqual((OUTLINE_STROKE / 2) * (2 / SQ3) + 1e-4);
    }
  });

  it("keeps the inner corners sharp and the outer corners round", () => {
    let outerCorner = 0;
    let innerCorner = Infinity;
    for (let i = 0; i < count(ring); i++) {
      const [x, y] = vertexOf(ring, i);
      const radius = Math.hypot(x, y);
      outerCorner = Math.max(outerCorner, radius);
      if (radius < R) innerCorner = Math.min(innerCorner, radius);
    }
    expect(outerCorner).toBeCloseTo(R + OUTLINE_STROKE / 2, 3);
    // Sharp: the inner hexagon's vertex reaches its full circumradius, uncut by any radius.
    expect(innerCorner).toBeCloseTo((APOTHEM - OUTLINE_STROKE / 2) * (2 / SQ3), 3);
  });

  it("gives each bond the stroke, length and offset of mark.ts", () => {
    const cap = BOND_STROKE / 2;
    const one = Math.PI * cap * cap + 2 * BOND_HALF * BOND_STROKE;
    // Caps are polygons, so the area sits a hair under the true circle's: within 0.1%.
    expect(frontArea(bonds) / (3 * one)).toBeCloseTo(1, 2);

    // The top bond: y runs from offset - cap to offset + cap, x spans the half length plus the cap.
    let top = 0;
    let bottom = Infinity;
    let side = 0;
    for (let i = 0; i < count(bonds); i++) {
      const [x, y] = vertexOf(bonds, i);
      if (y < 30) continue;
      top = Math.max(top, y);
      bottom = Math.min(bottom, y);
      side = Math.max(side, Math.abs(x));
    }
    expect(top).toBeCloseTo(BOND_OFFSET + cap, 3);
    expect(bottom).toBeCloseTo(BOND_OFFSET - cap, 3);
    expect(side).toBeCloseTo(BOND_HALF + cap, 3);
  });

  it("clears the ring through a whole turn", () => {
    let furthest = 0;
    for (let i = 0; i < count(bonds); i++) {
      const [x, y] = vertexOf(bonds, i);
      furthest = Math.max(furthest, Math.hypot(x, y));
    }
    expect(furthest).toBeLessThan(APOTHEM - OUTLINE_STROKE / 2);
  });

  it("puts the bonds on the same plane as the ring", () => {
    expect(bounds(bonds).z).toBeCloseTo(bounds(ring).z, 6);
  });

  it("sits the bonds on alternate edges, and a 60° turn lands them on the others", () => {
    // Bond centres, found as the centroid of each third of the solid.
    const third = count(bonds) / 3;
    const directions = [0, 1, 2].map((b) => {
      let x = 0;
      let y = 0;
      for (let i = b * third; i < (b + 1) * third; i++) {
        const [px, py] = vertexOf(bonds, i);
        x += px / third;
        y += py / third;
      }
      expect(Math.hypot(x, y)).toBeCloseTo(BOND_OFFSET, 3);
      return (((Math.atan2(y, x) * 180) / Math.PI) % 360 + 360) % 360;
    });
    expect(directions.map((d) => Math.round(d)).sort((a, b) => a - b)).toEqual([90, 210, 330]);

    // The hexagon's edge normals are 30° + 60k: rest takes every other one, a turn the rest.
    const turned = directions.map((d) => Math.round((d + 60) % 360)).sort((a, b) => a - b);
    expect(turned).toEqual([30, 150, 270]);
  });
});

describe("surface", () => {
  it.each([
    ["ring", ring],
    ["bonds", bonds],
  ])("every %s normal is unit length", (_, solid) => {
    for (let i = 0; i < count(solid); i++) {
      const [x, y, z] = normalOf(solid, i);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
    }
  });

  it.each([
    ["ring", ring],
    ["bonds", bonds],
  ])("every %s triangle faces the way its normals say", (_, solid) => {
    for (let t = 0; t < solid.indices.length; t += 3) {
      const ia = solid.indices[t]!;
      const ib = solid.indices[t + 1]!;
      const ic = solid.indices[t + 2]!;
      const [ax, ay, az] = vertexOf(solid, ia);
      const [bx, by, bz] = vertexOf(solid, ib);
      const [cx, cy, cz] = vertexOf(solid, ic);
      const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const [mx, my, mz] = [ia, ib, ic].map((i) => normalOf(solid, i)).reduce((sum, n) => [sum[0]! + n[0], sum[1]! + n[1], sum[2]! + n[2]], [0, 0, 0]);
      expect(nx * mx! + ny * my! + nz * mz!).toBeGreaterThan(0);
    }
  });

  it.each([
    ["ring", ring],
    ["bonds", bonds],
  ])("the %s is watertight", (_, solid) => {
    const key = (i: number) => vertexOf(solid, i).map((v) => v.toFixed(3)).join();
    const edges = new Map<string, number>();
    const add = (a: string, b: string) => edges.set(`${a}|${b}`, (edges.get(`${a}|${b}`) ?? 0) + 1);
    for (let t = 0; t < solid.indices.length; t += 3) {
      const [a, b, c] = [solid.indices[t]!, solid.indices[t + 1]!, solid.indices[t + 2]!].map(key) as [string, string, string];
      add(a, b);
      add(b, c);
      add(c, a);
    }
    for (const [edge, uses] of edges) {
      const [a, b] = edge.split("|");
      expect(uses, edge).toBe(1);
      expect(edges.get(`${b}|${a}`), edge).toBe(1);
    }
  });

  it("crowns the face: flat on the centre line, leaning outward toward the bevel", () => {
    const top = SOLID_DEFAULTS.thickness / 2;
    let flat = 0;
    let lean = 0;
    for (let i = 0; i < count(ring); i++) {
      const [, , z] = vertexOf(ring, i);
      const [, , nz] = normalOf(ring, i);
      if (z < top - 0.05) continue;
      const degrees = (Math.acos(Math.min(1, nz)) * 180) / Math.PI;
      if (degrees < 1e-3) flat++;
      lean = Math.max(lean, degrees);
    }
    expect(flat).toBeGreaterThan(0);
    expect(lean).toBeCloseTo(SOLID_DEFAULTS.crown, 2);
  });

  it("leans the wall's normals toward each bevel, so a wall shades instead of being one tone", () => {
    const lean = SOLID_DEFAULTS.wallLean;
    const { bevel, thickness } = SOLID_DEFAULTS;
    const leans = new Set<number>();
    for (let i = 0; i < count(ring); i++) {
      const [x, y, z] = vertexOf(ring, i);
      const [, , nz] = normalOf(ring, i);
      // The outer wall: the silhouette's own contour, where the bevels end.
      if (Math.abs(Math.abs(z) - (thickness / 2 - bevel)) > 1e-3 || Math.hypot(x, y) < R) continue;
      expect(Math.sign(nz)).toBe(Math.sign(z));
      leans.add(Math.round((Math.asin(Math.abs(nz)) * 180) / Math.PI * 1000) / 1000);
    }
    expect([...leans]).toEqual([lean]);
  });

  it("stays a modest mesh", () => {
    expect(count(ring) + count(bonds)).toBeLessThan(6000);
  });
});
