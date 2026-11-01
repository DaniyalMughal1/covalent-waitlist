// A small stable-fluids solver (Stam, "Stable Fluids", 1999) on the CPU, for the hero's
// cursor. The pointer splats velocity and dye into a coarse grid; the velocity pushes
// the mark's dots around, and the dye is the mask that reveals the agent feed.
//
// Units are grid cells and seconds. The box is closed: nothing flows through its edges.
// At rest everything is exactly zero and `idle` is true, so the frame loop can sleep.

export interface FluidOptions {
  /** Seconds for velocity to halve. */
  velocityHalfLife?: number;
  /** Seconds for dye to halve. */
  dyeHalfLife?: number;
  /** Jacobi iterations for the pressure solve. */
  iterations?: number;
}

const EPSILON = 1e-3;

export class Fluid {
  readonly w: number;
  readonly h: number;
  u: Float32Array;
  v: Float32Array;
  dye: Float32Array;
  private u0: Float32Array;
  private v0: Float32Array;
  private dye0: Float32Array;
  private readonly p: Float32Array;
  private readonly div: Float32Array;
  private readonly velocityHalfLife: number;
  private readonly dyeHalfLife: number;
  private readonly iterations: number;
  /** Fastest cell, in cells per second, after the last step. */
  speed = 0;
  /** Densest cell after the last step. */
  maxDye = 0;
  private live = false;

  constructor(w: number, h: number, options: FluidOptions = {}) {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.u = new Float32Array(n);
    this.v = new Float32Array(n);
    this.dye = new Float32Array(n);
    this.u0 = new Float32Array(n);
    this.v0 = new Float32Array(n);
    this.dye0 = new Float32Array(n);
    this.p = new Float32Array(n);
    this.div = new Float32Array(n);
    this.velocityHalfLife = options.velocityHalfLife ?? 0.3;
    this.dyeHalfLife = options.dyeHalfLife ?? 0.55;
    this.iterations = options.iterations ?? 20;
  }

  /** Nothing is moving and no dye is left: stepping would change nothing. */
  get idle(): boolean {
    return !this.live;
  }

  /**
   * Adds a soft blob of velocity (dx, dy in cells per second) and dye at (x, y), with a
   * Gaussian falloff of `radius` cells.
   */
  splat(x: number, y: number, dx: number, dy: number, radius: number, dye = 1): void {
    const r2 = radius * radius;
    const reach = Math.ceil(radius * 3);
    const x0 = Math.max(1, Math.floor(x - reach));
    const x1 = Math.min(this.w - 2, Math.ceil(x + reach));
    const y0 = Math.max(1, Math.floor(y - reach));
    const y1 = Math.min(this.h - 2, Math.ceil(y + reach));
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const fall = Math.exp(-((i - x) ** 2 + (j - y) ** 2) / r2);
        if (fall < 1e-3) continue;
        const k = j * this.w + i;
        this.u[k]! += dx * fall;
        this.v[k]! += dy * fall;
        this.dye[k] = Math.min(1, this.dye[k]! + dye * fall);
      }
    }
    if (x1 >= x0 && y1 >= y0) this.live = true;
  }

  step(dt: number): void {
    if (!this.live || dt <= 0) return;
    const { w, h } = this;
    // Velocity carries itself, then is made divergence-free so it swirls instead of piling up.
    this.advect(this.u0, this.u, this.u, this.v, dt);
    this.advect(this.v0, this.v, this.u, this.v, dt);
    [this.u, this.u0] = [this.u0, this.u];
    [this.v, this.v0] = [this.v0, this.v];
    this.walls();
    this.project();
    this.advect(this.dye0, this.dye, this.u, this.v, dt);
    [this.dye, this.dye0] = [this.dye0, this.dye];

    const fadeV = Math.pow(0.5, dt / this.velocityHalfLife);
    const fadeD = Math.pow(0.5, dt / this.dyeHalfLife);
    let speed = 0;
    let maxDye = 0;
    for (let k = 0; k < w * h; k++) {
      const u = (this.u[k]! *= fadeV);
      const v = (this.v[k]! *= fadeV);
      const d = (this.dye[k]! *= fadeD);
      const s = u * u + v * v;
      if (s > speed) speed = s;
      if (d > maxDye) maxDye = d;
    }
    this.speed = Math.sqrt(speed);
    this.maxDye = maxDye;
    if (this.speed < EPSILON && this.maxDye < EPSILON) this.clear();
  }

  /** Velocity at (x, y) in cells, bilinear, into `out`. */
  velocityAt(x: number, y: number, out: Float32Array | number[]): void {
    out[0] = this.sample(this.u, x, y);
    out[1] = this.sample(this.v, x, y);
  }

  dyeAt(x: number, y: number): number {
    return this.sample(this.dye, x, y);
  }

  clear(): void {
    this.u.fill(0);
    this.v.fill(0);
    this.dye.fill(0);
    this.p.fill(0);
    this.speed = 0;
    this.maxDye = 0;
    this.live = false;
  }

  private sample(field: Float32Array, x: number, y: number): number {
    const { w, h } = this;
    const fx = Math.max(0, Math.min(w - 1.001, x));
    const fy = Math.max(0, Math.min(h - 1.001, y));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const s = fx - i;
    const t = fy - j;
    const k = j * w + i;
    const a = field[k]! + (field[k + 1]! - field[k]!) * s;
    const b = field[k + w]! + (field[k + w + 1]! - field[k + w]!) * s;
    return a + (b - a) * t;
  }

  // Semi-Lagrangian: each cell takes the value found by tracing its velocity back in time.
  private advect(out: Float32Array, src: Float32Array, u: Float32Array, v: Float32Array, dt: number): void {
    const { w, h } = this;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        out[k] = this.sample(src, i - dt * u[k]!, j - dt * v[k]!);
      }
    }
  }

  // A closed box: no flow across the outer ring of cells.
  private walls(): void {
    const { w, h } = this;
    for (let i = 0; i < w; i++) {
      this.u[i] = this.v[i] = 0;
      this.u[(h - 1) * w + i] = this.v[(h - 1) * w + i] = 0;
    }
    for (let j = 0; j < h; j++) {
      this.u[j * w] = this.v[j * w] = 0;
      this.u[j * w + w - 1] = this.v[j * w + w - 1] = 0;
    }
  }

  private project(): void {
    const { w, h, p, div, u, v } = this;
    for (let j = 1; j < h - 1; j++) {
      for (let i = 1; i < w - 1; i++) {
        const k = j * w + i;
        div[k] = -0.5 * (u[k + 1]! - u[k - 1]! + v[k + w]! - v[k - w]!);
      }
    }
    // Starts from the last solve: pressure barely changes frame to frame, so few iterations do.
    for (let n = 0; n < this.iterations; n++) {
      for (let j = 1; j < h - 1; j++) {
        for (let i = 1; i < w - 1; i++) {
          const k = j * w + i;
          p[k] = (div[k]! + p[k - 1]! + p[k + 1]! + p[k - w]! + p[k + w]!) / 4;
        }
      }
    }
    for (let j = 1; j < h - 1; j++) {
      for (let i = 1; i < w - 1; i++) {
        const k = j * w + i;
        u[k]! -= 0.5 * (p[k + 1]! - p[k - 1]!);
        v[k]! -= 0.5 * (p[k + w]! - p[k - w]!);
      }
    }
    this.walls();
  }

  /** Mean absolute divergence over the interior, for tests. */
  divergence(): number {
    const { w, h, u, v } = this;
    let sum = 0;
    for (let j = 1; j < h - 1; j++) {
      for (let i = 1; i < w - 1; i++) {
        const k = j * w + i;
        sum += Math.abs(0.5 * (u[k + 1]! - u[k - 1]! + v[k + w]! - v[k - w]!));
      }
    }
    return sum / ((w - 2) * (h - 2));
  }
}
