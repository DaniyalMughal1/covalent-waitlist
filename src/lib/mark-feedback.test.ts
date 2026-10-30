import { describe, expect, it } from "vitest";
import { INNER_RADIUS, MarkFeedback } from "./mark-feedback";
const advance = (mark: MarkFeedback, seconds: number) => { for (let i = 0; i < seconds * 60; i++) mark.update(1 / 60, true); };
describe("terminal logo feedback", () => {
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
  });
});
