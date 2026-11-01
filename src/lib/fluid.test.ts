import { describe, expect, it } from "vitest";
import { Fluid } from "./fluid";

const run = (fluid: Fluid, seconds: number, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) fluid.step(dt);
};

describe("cursor fluid", () => {
  it("does nothing until something stirs it", () => {
    const fluid = new Fluid(32, 18);
    expect(fluid.idle).toBe(true);
    run(fluid, 1);
    expect(fluid.speed).toBe(0);
    expect(fluid.maxDye).toBe(0);
    expect(fluid.u.every((x) => x === 0)).toBe(true);
  });

  it("carries a splat along and lets it fade back to exactly nothing", () => {
    const fluid = new Fluid(64, 36);
    fluid.splat(20, 18, 60, 0, 3);
    expect(fluid.idle).toBe(false);
    fluid.step(1 / 60);
    const out = new Float32Array(2);
    fluid.velocityAt(22, 18, out);
    expect(out[0]).toBeGreaterThan(0);
    // The dye drifts with the flow, to the right of where it started.
    run(fluid, 0.3);
    expect(fluid.dyeAt(25, 18)).toBeGreaterThan(fluid.dyeAt(15, 18));
    run(fluid, 6);
    expect(fluid.idle).toBe(true);
    expect(fluid.maxDye).toBe(0);
  });

  it("removes most of the divergence a splat brings, so the flow swirls instead of piling up", () => {
    // This grid stores velocity at cell centres, which leaves a little checkerboard
    // divergence no solve can see; compared with no solve at all, most of it is gone.
    const after = (iterations: number) => {
      const fluid = new Fluid(64, 36, { velocityHalfLife: 10, iterations });
      fluid.splat(32, 18, 80, 30, 4);
      fluid.step(1 / 60);
      fluid.step(1 / 60);
      return fluid.divergence();
    };
    expect(after(20)).toBeLessThan(after(0) * 0.45);
  });

  it("stays finite at the largest step the frame loop allows", () => {
    const fluid = new Fluid(64, 36);
    for (let i = 0; i < 40; i++) {
      fluid.splat(10 + i, 18, 400, -200, 3);
      fluid.step(1 / 20);
    }
    expect(fluid.u.every(Number.isFinite)).toBe(true);
    expect(fluid.dye.every((d) => d >= 0 && d <= 1)).toBe(true);
  });
});
