import { describe, expect, it } from "vitest";
import {
  AGENT_HALF,
  AGENT_THICKNESS,
  GROUND_BOX,
  POSE,
  SHARED_BOX,
  TOKEN_OFFSET,
  buildScene,
  handoffLength,
  handoffPoint,
  plate,
  project,
  sheetMatrix,
} from "./process-scene";

const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe("project", () => {
  it("is the 2:1 dimetric projection", () => {
    expect(project(0, 0, 0)).toEqual([0, 0]);
    expect(project(10, 0, 0)).toEqual([10, 5]);
    expect(project(0, 10, 0)).toEqual([-10, 5]);
    expect(project(0, 0, 10)).toEqual([0, -10]);
  });

  it("keeps every world axis at the same slope", () => {
    const [x, y] = project(100, 0, 0);
    expect(y / x).toBe(0.5);
  });
});

describe("plate", () => {
  const box = { x0: -50, y0: -50, x1: 50, y1: 50 };
  const made = plate({ box, top: 30, thickness: 20, radius: 8, inset: 6, band: 4, ribs: [4, 8] });

  it("closes every filled face", () => {
    for (const face of [made.top, made.wallLeft, made.wallRight, made.bandLeft, made.bandRight, made.inset]) {
      expect(face.endsWith("Z")).toBe(true);
    }
  });

  it("gives both walls the same thickness on screen", () => {
    const rise = (d: string) => {
      const ys = numbers(d).filter((_, i) => i % 2 === 1);
      return Math.max(...ys) - Math.min(...ys);
    };
    const flat = plate({ box, top: 30, thickness: 0, radius: 8, inset: 6 });
    expect(rise(made.wallLeft) - rise(flat.wallLeft)).toBeCloseTo(20, 1);
    expect(rise(made.wallRight) - rise(flat.wallRight)).toBeCloseTo(20, 1);
  });

  it("is symmetric about the vertical through its front corner", () => {
    const xs = numbers(made.top).filter((_, i) => i % 2 === 0);
    expect(Math.max(...xs)).toBeCloseTo(-Math.min(...xs), 1);
  });

  it("draws ribs as vertical strokes on both walls", () => {
    const segments = made.ribs.split("M").filter(Boolean);
    expect(segments).toHaveLength(4);
    for (const segment of segments) {
      const [x1, , x2] = numbers(segment);
      expect(x1).toBe(x2);
    }
  });

  it("bounds the whole plate", () => {
    const xs = numbers(made.top).filter((_, i) => i % 2 === 0);
    expect(made.bounds.x).toBeLessThanOrEqual(Math.min(...xs));
    expect(made.bounds.x + made.bounds.w).toBeGreaterThanOrEqual(Math.max(...xs));
  });
});

describe("sheetMatrix", () => {
  it("lays a sheet flat: x rises to the right, y falls to the right, at 2:1", () => {
    expect(sheetMatrix(0, 0)).toBe("matrix(1 -0.5 1 0.5 0 0)");
  });
});

describe("the world layout", () => {
  it("keeps the base larger than the shared plane", () => {
    expect(GROUND_BOX.x0).toBeLessThan(SHARED_BOX.x0);
    expect(GROUND_BOX.x1).toBeGreaterThan(SHARED_BOX.x1);
    expect(GROUND_BOX.y0).toBeLessThan(SHARED_BOX.y0);
    expect(GROUND_BOX.y1).toBeGreaterThan(SHARED_BOX.y1);
  });

  it("gives each claimed plate room over the shared plane, so its footprint lands on it", () => {
    expect(POSE.claim.x + AGENT_HALF).toBeLessThan(SHARED_BOX.x1);
    expect(POSE.claim.y - AGENT_HALF).toBeGreaterThan(SHARED_BOX.y0);
    expect(POSE.claim.y + AGENT_HALF).toBeLessThan(SHARED_BOX.y1);
  });

  it("separates by tens of world units", () => {
    expect(POSE.claim.x - POSE.rest.x).toBeGreaterThan(60);
    expect(POSE.claim.z - POSE.rest.z).toBeGreaterThan(60);
  });

  it("docks the pair on the base, in front of the shared plane, and touching nothing", () => {
    const { ui, api } = POSE.dock;
    expect(ui.y - AGENT_HALF).toBeGreaterThan(SHARED_BOX.y1);
    expect(api.x - ui.x).toBeGreaterThanOrEqual(AGENT_HALF * 2);
    expect(api.x - ui.x).toBeLessThan(AGENT_HALF * 2 + 8);
    expect(ui.y + AGENT_HALF).toBeLessThan(GROUND_BOX.y1);
  });
});

describe("the handoff curve", () => {
  it("runs from the API plate's top to the UI plate's top", () => {
    const top = POSE.claim.z + AGENT_THICKNESS;
    const [sx, , sz] = handoffPoint(0);
    const [ex, , ez] = handoffPoint(1);
    expect(sx).toBeCloseTo(POSE.claim.x + TOKEN_OFFSET.api, 6);
    expect(ex).toBeCloseTo(-POSE.claim.x + TOKEN_OFFSET.ui, 6);
    expect(sz).toBeCloseTo(top, 6);
    expect(ez).toBeCloseTo(top, 6);
  });

  it("rises over the plane between them", () => {
    expect(handoffPoint(0.5)[2]).toBeGreaterThan(POSE.claim.z + AGENT_THICKNESS + 60);
  });

  it("moves evenly along its on-screen length", () => {
    const steps = 40;
    const expected = handoffLength() / steps;
    for (let i = 1; i <= steps; i += 1) {
      const a = project(...handoffPoint((i - 1) / steps));
      const b = project(...handoffPoint(i / steps));
      expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(expected, 0);
    }
  });

  it("clamps outside its range", () => {
    expect(handoffPoint(-1)).toEqual(handoffPoint(0));
    expect(handoffPoint(2)).toEqual(handoffPoint(1));
  });
});

describe("buildScene", () => {
  const scene = buildScene();

  it("draws the two reading lines as one move, mirrored through the brief", () => {
    const span = (line: typeof scene.reads.ui) => [line.tip[0] - line.from[0], line.tip[1] - line.from[1]];
    const [ux, uy] = span(scene.reads.ui);
    const [ax, ay] = span(scene.reads.api);
    expect(ux).toBeCloseTo(-ax, 6);
    expect(uy).toBeCloseTo(-ay, 6);
  });

  it("starts each reading line clear of the words and of the plate that rests beside them", () => {
    const { rest } = POSE;
    const nearEdge = rest.x - AGENT_HALF - (rest.z + AGENT_THICKNESS);
    const startX = (line: typeof scene.reads.ui) => (line.from[0] + 2 * line.from[1]) / 2;
    expect(startX(scene.reads.api)).toBeLessThan(nearEdge - 6);
  });

  it("is deterministic, so the prerendered page never changes between builds", () => {
    expect(buildScene()).toEqual(scene);
  });

  it("produces only finite numbers", () => {
    const text = JSON.stringify(scene);
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("Infinity");
  });
});
