import { describe, expect, it } from "vitest";
import { INNER_RADIUS, MarkFeedback, type BondPoint } from "./mark-feedback";
const advance = (mark: MarkFeedback, seconds: number) => { for (let i = 0; i < seconds * 60; i++) mark.update(1 / 60, true); };
describe("terminal logo feedback", () => {
  it("reveals the solid, staggers bars, and makes one coordinated movement", () => {
    const mark = new MarkFeedback();
    mark.startArrival(true);
    expect(mark.draw).toBe(0);
    expect(mark.arrivalScale).toBe(.97);
    mark.update(.225, true);
    expect(mark.draw).toBeCloseTo(.5);
    expect(mark.bondGrowth(0)).toBe(0);
    mark.update(.225, true);
    expect(mark.draw).toBe(1);
    expect(mark.arrivalScale).toBe(1);
    expect(mark.bondGrowth(0)).toBeGreaterThan(mark.bondGrowth(1));
    expect(mark.bondGrowth(1)).toBeGreaterThan(mark.bondGrowth(2));
    mark.update(.5, true);
    expect(mark.bondGrowth(2)).toBe(1);
    mark.update(.325, true);
    expect(mark.rotation).toBeCloseTo(60);
    advance(mark, 1);
    expect(mark.target).toBe(120);
    expect(mark.rotation).toBe(120);
    expect(mark.animating).toBe(false);
    mark.startArrival(true);
    expect(mark.draw).toBe(1);
  });
  it("lets edits interrupt startup without later greeting hops", () => {
    const mark = new MarkFeedback();
    mark.startArrival(true);
    mark.update(.3, true);
    mark.hop(-1);
    advance(mark, 4);
    expect(mark.draw).toBe(1);
    expect(mark.bondGrow).toBe(1);
    expect(mark.target).toBe(-60);
  });
  it("skips startup for reduced motion", () => {
    const mark = new MarkFeedback();
    mark.startArrival(false);
    advance(mark, 4);
    expect(mark.draw).toBe(1);
    expect(mark.bondGrow).toBe(1);
    expect(mark.target).toBe(0);
  });
  it("hops sixty degrees per edit without jumping at high typing speeds", () => {
    const mark = new MarkFeedback();
    for (let i = 0; i < 30; i++) mark.hop();
    mark.update(1 / 60, true);
    expect(mark.target).toBe(1800);
    expect(mark.rotation).toBeLessThanOrEqual(15);
    advance(mark, 4);
    expect(mark.rotation).toBe(1800);
  });
  it("forms the working circle and only shows done after confirmed completion", () => {
    const mark = new MarkFeedback();
    mark.setWorking(true); advance(mark, 1);
    expect(mark.circle).toBe(1);
    expect(mark.done).toBe(0);
    mark.setWorking(false); advance(mark, 1);
    expect(mark.done).toBe(0);
    mark.finish(); advance(mark, 1);
    expect(mark.circle).toBe(0);
    expect(mark.done).toBe(1);
    mark.hop(); advance(mark, 1);
    expect(mark.done).toBe(0);
  });
  it("uses a stable immediate result for reduced motion", () => {
    const mark = new MarkFeedback();
    mark.hop(); mark.update(0, false);
    expect(mark.rotation).toBe(60);
    mark.finish(); mark.update(0, false);
    expect(mark.done).toBe(1);
  });
});


describe("terminal geometry", () => {
  it("bends a stroke across a hexagon corner instead of rotating a straight bar", () => {
    const mark = new MarkFeedback();
    mark.rotation = 30;
    const points = mark.points().slice(0, 60);
    for (const [x, y] of points) {
      const edgeDistance = Math.max(...[30, 90, 150, 210, 270, 330].map(a => x * Math.cos(a * Math.PI / 180) + y * Math.sin(a * Math.PI / 180)));
      expect(edgeDistance).toBeCloseTo(INNER_RADIUS, 8);
    }
    const a = points[0]!, b = points[30]!, c = points[59]!;
    expect(Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))).toBeGreaterThan(10);
  });
  it("backspace retraces the hop in reverse", () => {
    const mark = new MarkFeedback();
    mark.hop(); advance(mark, 1);
    expect(mark.rotation).toBe(60);
    mark.hop(-1); mark.update(1 / 60, true);
    expect(mark.rotation).toBeLessThan(60);
    expect(mark.rotation).toBeGreaterThan(0);
    advance(mark, 1);
    expect(mark.rotation).toBe(0);
  });
  it("moves the same 180 points into the terminal's exact check endpoints", () => {
    const mark = new MarkFeedback();
    mark.finish(); advance(mark, 1);
    const points = mark.points();
    expect(points).toHaveLength(180);
    expect(points[0]![0]).toBeCloseTo(-.55 * INNER_RADIUS * 1.05, 8);
    expect(points[0]![1]).toBeCloseTo(0, 8);
    expect(points[179]![0]).toBeCloseTo(.6 * INNER_RADIUS * 1.05, 8);
    expect(points[179]![1]).toBeCloseTo(-.5 * INNER_RADIUS * 1.05, 8);
    for (const [end, start] of [[59, 60], [119, 120]] as const) {
      expect(points[end]![0]).toBeCloseTo(points[start]![0], 8);
      expect(points[end]![1]).toBeCloseTo(points[start]![1], 8);
    }
  });
  it("lets the spinning ring come to rest before the check starts", () => {
    const mark = new MarkFeedback();
    mark.setWorking(true); advance(mark, 1);
    mark.setWorking(false); mark.finish();
    advance(mark, .6);
    expect(mark.done).toBe(0);
    advance(mark, 1);
    expect(mark.done).toBe(1);
    expect(mark.rotation % 120).toBe(0);
  });
  it.each([0, 1, 2, 3, 4, 5])("takes straight bars into the check without crossing, after %i hops", (hops) => {
    const mark = new MarkFeedback();
    for (let i = 0; i < hops; i++) mark.hop();
    mark.finish();
    const side = (a: BondPoint, b: BondPoint, c: BondPoint) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const crosses = (p: BondPoint, q: BondPoint, r: BondPoint, s: BondPoint) =>
      side(p, q, r) * side(p, q, s) < -1e-6 && side(r, s, p) * side(r, s, q) < -1e-6;
    let forming = 0;
    for (let frame = 0; frame < 150; frame++) {
      mark.update(1 / 60, true);
      if (mark.done === 0) continue;
      forming++;
      const points = mark.points();
      const bars = [0, 1, 2].map(i => [points[i * 60]!, points[i * 60 + 30]!, points[i * 60 + 59]!] as const);
      for (const [a, middle, b] of bars) {
        expect(Math.abs(side(a, b, middle))).toBeLessThan(1);
        expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeGreaterThan(20);
      }
      for (const [i, j] of [[0, 1], [0, 2], [1, 2]] as const) {
        expect(crosses(bars[i]![0], bars[i]![2], bars[j]![0], bars[j]![2])).toBe(false);
      }
    }
    expect(forming).toBeGreaterThan(30);
    expect(mark.done).toBe(1);
  });
});
