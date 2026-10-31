import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Sphere, Vector3 } from "three";
import { crossSection, SOLID_DEFAULTS } from "./mark-solid";
import { BOND_STROKE } from "./mark";
import type { BondPoint } from "./mark-feedback";

const CAP = 24;
// Where two strokes meet, one's rounded end lies inside the other's body at the same height,
// and the two would flicker through each other. A hair lower, the end stays hidden.
const CAP_DROP = .12;
// The original mark's flat face and rounded bevel, swept along the terminal's moving
// centreline. Buffers stay allocated; no geometry creation/disposal occurs per frame.
export class MarkRibbon extends BufferGeometry {
  private readonly rows = crossSection(BOND_STROKE / 2, SOLID_DEFAULTS);
  private readonly count: number;
  private readonly stations: number;
  private readonly positions: Float32Array;
  private readonly normals: Float32Array;
  private readonly colours: Float32Array;
  private readonly tangents: Float64Array;

  constructor(count: number) {
    super();
    this.count = count;
    this.stations = count * 2 + CAP * 2;
    this.positions = new Float32Array(this.stations * this.rows.length * 3);
    this.normals = new Float32Array(this.positions.length);
    this.colours = new Float32Array(this.positions.length);
    this.tangents = new Float64Array(count * 3);
    for (const [name, array] of [["position", this.positions], ["normal", this.normals], ["color", this.colours]] as const) {
      this.setAttribute(name, new BufferAttribute(array, 3).setUsage(DynamicDrawUsage));
    }
    const indices: number[] = [];
    const width = this.rows.length;
    for (let i = 0; i < this.stations; i++) {
      const next = (i + 1) % this.stations;
      for (let k = 0; k < width - 1; k++) {
        const a = i * width + k, b = next * width + k;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    this.setIndex(indices);
    this.boundingSphere = new Sphere(new Vector3(), 120);
  }

  update(points: readonly BondPoint[], depth = 0) {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const p = points[i]!, prev = points[Math.max(0, i - 1)]!, next = points[Math.min(n - 1, i + 1)]!;
      let ax = p[0] - prev[0], ay = prev[1] - p[1];
      let bx = next[0] - p[0], by = p[1] - next[1];
      if (i === 0) { ax = bx; ay = by; }
      if (i === n - 1) { bx = ax; by = ay; }
      const al = Math.hypot(ax, ay) || 1, bl = Math.hypot(bx, by) || 1;
      ax /= al; ay /= al; bx /= bl; by /= bl;
      let nx = -ay - by, ny = ax + bx;
      const length = Math.hypot(nx, ny);
      if (length < 1e-6) { nx = -ay; ny = ax; }
      else { nx /= length; ny /= length; }
      this.tangents.set([nx, ny, 1 / Math.max(.5, nx * -ay + ny * ax)], i * 3);
    }
    let station = 0;
    const write = (point: BondPoint, nx: number, ny: number, miter: number, drop = 0) => {
      for (let k = 0; k < this.rows.length; k++) {
        const row = this.rows[k]!, at = (station * this.rows.length + k) * 3;
        this.positions[at] = point[0] + nx * row.h * miter;
        this.positions[at + 1] = -point[1] + ny * row.h * miter;
        this.positions[at + 2] = row.z + depth - drop;
        this.normals[at] = nx * row.radial;
        this.normals[at + 1] = ny * row.radial;
        this.normals[at + 2] = row.axial;
        this.colours[at] = this.colours[at + 1] = this.colours[at + 2] = point[2];
      }
      station++;
    };
    for (let i = 0; i < n; i++) write(points[i]!, this.tangents[i * 3]!, this.tangents[i * 3 + 1]!, this.tangents[i * 3 + 2]!);
    const endAngle = Math.atan2(this.tangents[(n - 1) * 3 + 1]!, this.tangents[(n - 1) * 3]!);
    for (let k = 1; k <= CAP; k++) {
      const a = endAngle - Math.PI * k / CAP;
      write(points[n - 1]!, Math.cos(a), Math.sin(a), 1, k < CAP ? CAP_DROP : 0);
    }
    for (let i = n - 1; i >= 0; i--) write(points[i]!, -this.tangents[i * 3]!, -this.tangents[i * 3 + 1]!, this.tangents[i * 3 + 2]!);
    const startAngle = Math.atan2(-this.tangents[1]!, -this.tangents[0]!);
    for (let k = 1; k <= CAP; k++) {
      const a = startAngle - Math.PI * k / CAP;
      write(points[0]!, Math.cos(a), Math.sin(a), 1, k < CAP ? CAP_DROP : 0);
    }
    this.attributes.position!.needsUpdate = true;
    this.attributes.normal!.needsUpdate = true;
    this.attributes.color!.needsUpdate = true;
  }
}
