// Geometry and timing ported from the terminal brand's Ring in references/brand/source/ring.ts.
// Coordinates remain on a fixed hexagon; rotating a rigid capsule cannot follow its corners.
const DEG = Math.PI / 180;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const inOut = (x: number) => x < .5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
const outCubic = (x: number) => 1 - (1 - x) ** 3;
export const INNER_RADIUS = 100 * Math.cos(30 * DEG) - 22;
export const GLYPH_POINTS = 180;
export type BondPoint = readonly [x: number, y: number, brightness: number];
const CHECK = [[-.55, 0], [-.17, .42], [.6, -.5]] as const;
const checkLengths = [Math.hypot(.38, .42), Math.hypot(.77, -.92)];
const checkTotal = checkLengths[0]! + checkLengths[1]!;
const checkPoints = Array.from({ length: GLYPH_POINTS }, (_, i) => {
  let d = checkTotal * i / (GLYPH_POINTS - 1);
  const j = d > checkLengths[0]! ? 1 : 0;
  if (j) d -= checkLengths[0]!;
  const t = Math.min(1, d / checkLengths[j]!);
  const a = CHECK[j]!, b = CHECK[j + 1]!;
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
});
type Shape = "bonds" | "swing" | "circle" | "settle";

export class MarkFeedback {
  rotation = 0;
  target = 0;
  circle = 0;
  done = 0;
  comet = 0;
  status: "idle" | "working" | "done" = "idle";
  engaged = false;
  private shape: Shape = "bonds";
  private shapeT = 0;
  private swingFrom = 0;
  private glyph = false;
  private settle = { r0: 0, r1: 0, m0: 0, c0: 0, dur: .9 };

  hop(direction = 1) {
    this.engaged = true;
    this.setStatus("idle");
    if (this.shape === "bonds") this.target += 60 * direction;
  }
  private setShape(shape: Shape) { this.shape = shape; this.shapeT = 0; }
  private setStatus(status: typeof this.status) {
    if (status === this.status) return;
    this.status = status;
    if (status === "working") {
      if (this.shape === "bonds" || this.shape === "settle") {
        this.swingFrom = this.circle;
        this.setShape("swing");
      }
    } else if (this.shape === "swing" || this.shape === "circle") {
      const dur = .9;
      this.settle = { r0: this.rotation, r1: Math.ceil((this.rotation + 600 * dur / 3) / 60) * 60, m0: this.circle, c0: this.comet, dur };
      this.setShape("settle");
    }
  }
  setWorking(value: boolean) {
    if (value) { this.engaged = true; this.setStatus("working"); }
    else if (this.status === "working") this.setStatus("idle");
  }
  finish() { this.engaged = true; this.setStatus("done"); }

  update(dt: number, animate: boolean) {
    if (!animate) {
      this.rotation = this.target;
      this.circle = this.status === "working" ? 1 : 0;
      this.comet = this.circle;
      this.done = this.status === "done" ? 1 : 0;
      this.glyph = this.done === 1;
      this.setShape(this.status === "working" ? "circle" : "bonds");
      return;
    }
    this.shapeT += dt;
    const want = this.status === "done";
    if (want !== this.glyph) {
      this.done = Math.max(0, this.done - dt / .35);
      if (this.done === 0) this.glyph = want;
    } else if (want) this.done = Math.min(1, this.done + dt / .7);

    switch (this.shape) {
      case "bonds": {
        const step = (this.target - this.rotation) * (1 - Math.exp(-dt * 16));
        this.rotation += Math.sign(step) * Math.min(Math.abs(step), 900 * dt);
        if (Math.abs(this.target - this.rotation) < .01) this.rotation = this.target;
        this.circle = this.comet = 0;
        break;
      }
      case "swing": {
        const u = clamp01(this.swingFrom + this.shapeT / .7);
        this.circle = inOut(u);
        this.rotation += 600 * u * u * dt;
        this.comet = this.circle;
        if (u >= 1) this.setShape("circle");
        break;
      }
      case "circle":
        this.rotation += 600 * dt;
        this.circle = this.comet = 1;
        break;
      case "settle": {
        const { r0, r1, m0, c0, dur } = this.settle;
        const u = clamp01(this.shapeT / dur);
        this.rotation = lerp(r0, r1, outCubic(u));
        this.circle = m0 * (1 - inOut(span(u, .2, 1)));
        this.comet = c0 * (1 - span(u, 0, .6));
        if (u >= 1) {
          this.rotation = this.target = r1;
          this.circle = this.comet = 0;
          this.setShape("bonds");
        }
        break;
      }
    }
  }

  points(): BondPoint[] {
    const width = lerp(40, 121, this.circle);
    const points: BondPoint[] = [];
    for (let section = 0; section < 3; section++) {
      const centre = [270, 30, 150][section]! + this.rotation;
      for (let i = 0; i < 60; i++) {
        const th = centre - width / 2 + width * i / 59;
        let d = (((th - 30) % 60) + 60) % 60;
        if (d > 30) d -= 60;
        const radius = lerp(INNER_RADIUS / Math.cos(d * DEG), INNER_RADIUS * .95, this.circle);
        let x = radius * Math.cos(th * DEG), y = radius * Math.sin(th * DEG);
        const index = section * 60 + i;
        if (this.glyph && this.done > 0) {
          const e = inOut(clamp01(this.done * 1.4 - index / GLYPH_POINTS * .4));
          x = lerp(x, checkPoints[index]![0]! * INNER_RADIUS * 1.05, e);
          y = lerp(y, checkPoints[index]![1]! * INNER_RADIUS * 1.05, e);
        }
        const trail = (((this.rotation + 20 - th) % 360) + 360) % 360;
        const brightness = lerp(1, lerp(.3, 1, Math.exp(-trail / 75)), this.comet);
        points.push([x, y, brightness]);
      }
    }
    return points;
  }

  get animating() {
    return this.shape !== "bonds" || Math.abs(this.target - this.rotation) > .01 ||
      (this.status === "done" ? this.done < 1 : this.done > 0);
  }
}
