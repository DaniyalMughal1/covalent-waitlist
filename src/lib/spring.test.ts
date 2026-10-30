import { describe, expect, it } from "vitest";
import { atRest, damp, stepSpring, type Spring } from "./spring";

function run(spring: Spring, target: number, omega: number, zeta: number, dt: number, seconds: number) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) stepSpring(spring, target, omega, zeta, dt);
  return spring;
}

describe("stepSpring", () => {
  it.each([
    [9, 0.7],
    [9, 0.5],
    [12, 1],
  ])("lands in the same place at any frame rate (omega %d, zeta %d)", (omega, zeta) => {
    const slow = run({ x: 0, v: 3 }, 1, omega, zeta, 1 / 30, 0.4);
    const fast = run({ x: 0, v: 3 }, 1, omega, zeta, 1 / 240, 0.4);
    expect(fast.x).toBeCloseTo(slow.x, 9);
    expect(fast.v).toBeCloseTo(slow.v, 9);
  });

  it("overshoots by the amount damped-oscillator theory predicts", () => {
    const zeta = 0.7;
    const spring = { x: 0, v: 0 };
    let peak = 0;
    for (let i = 0; i < 2000; i++) {
      stepSpring(spring, 1, 9, zeta, 1 / 500);
      peak = Math.max(peak, spring.x);
    }
    expect(peak - 1).toBeCloseTo(Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)), 3);
  });

  it("does not overshoot when critically damped", () => {
    const spring = { x: 0, v: 0 };
    for (let i = 0; i < 2000; i++) {
      stepSpring(spring, 1, 12, 1, 1 / 500);
      expect(spring.x).toBeLessThanOrEqual(1);
    }
  });

  it("settles a bond turn inside the 600-800ms the motion spec asks for", () => {
    const spring = { x: 0, v: 0 };
    let settled = 0;
    for (let t = 0; t < 1.2; t += 1 / 240) {
      stepSpring(spring, 1, 9, 0.7, 1 / 240);
      if (Math.abs(spring.x - 1) > 0.02) settled = t;
    }
    expect(settled).toBeGreaterThan(0.45);
    expect(settled).toBeLessThan(0.8);
  });

  it("carries velocity through a change of target", () => {
    const spring = { x: 0.5, v: 4 };
    stepSpring(spring, 0, 9, 0.6, 1 / 120);
    expect(spring.x).toBeGreaterThan(0.5);
  });
});

describe("damp", () => {
  it("is independent of the frame rate", () => {
    let a = 0;
    let b = 0;
    for (let i = 0; i < 10; i++) a = damp(a, 1, 5, 1 / 30);
    for (let i = 0; i < 40; i++) b = damp(b, 1, 5, 1 / 120);
    expect(a).toBeCloseTo(b, 9);
  });
});

describe("atRest", () => {
  it("needs both position and velocity to have died away", () => {
    expect(atRest({ x: 1, v: 0 }, 1)).toBe(true);
    expect(atRest({ x: 1, v: 0.5 }, 1)).toBe(false);
    expect(atRest({ x: 1.1, v: 0 }, 1)).toBe(false);
  });
});
