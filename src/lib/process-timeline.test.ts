import { describe, expect, it } from "vitest";
import { AGENT_THICKNESS, GROUND_TOP, POSE, PRINT, PRINT_LAYOUT, SHARED_BOX, TOKEN_MAST, TOKEN_OFFSET, TOKEN_THICKNESS, handoffPoint, project } from "./process-scene";
import { BOUNDARIES, HOLDS, clamp, sceneAt, stageAt, type SceneState } from "./process-timeline";

const STEPS = 2000;
const grid = Array.from({ length: STEPS + 1 }, (_, i) => i / STEPS);

// Every number in a state, in a stable order, so states can be compared numerically.
const flatten = (value: unknown): number[] =>
  typeof value === "number"
    ? [value]
    : Object.values(value as object).flatMap((v) => flatten(v));

describe("purity", () => {
  it("returns identical state for the same p, whatever order it is visited in", () => {
    const forward = grid.map(sceneAt);
    const backward = [...grid].reverse().map(sceneAt).reverse();
    expect(backward).toEqual(forward);
  });

  it("clamps progress outside 0..1", () => {
    expect(sceneAt(-0.4)).toEqual(sceneAt(0));
    expect(sceneAt(1.7)).toEqual(sceneAt(1));
  });

  it("has no jumps: halving the step halves the largest change", () => {
    const largestStep = (steps: number) => {
      let largest = 0;
      for (let i = 1; i <= steps; i += 1) {
        const a = flatten({ ...sceneAt((i - 1) / steps), stage: 0 });
        const b = flatten({ ...sceneAt(i / steps), stage: 0 });
        a.forEach((value, k) => {
          largest = Math.max(largest, Math.abs(value - b[k]!));
        });
      }
      return largest;
    };
    // A real discontinuity stays the same size however finely it is sampled.
    expect(largestStep(8000)).toBeLessThan(largestStep(2000) * 0.3);
  });

  it("hands the token from the path to the plate without a seam", () => {
    const before = sceneAt(0.69 - 1e-6).token;
    const after = sceneAt(0.69 + 1e-6).token;
    expect(after.x).toBeCloseTo(before.x, 2);
    expect(after.y).toBeCloseTo(before.y, 2);
    expect(after.z).toBeCloseTo(before.z, 2);
  });
});

describe("stages", () => {
  it("changes exactly at the caption boundaries", () => {
    expect(stageAt(0)).toBe(0);
    expect(stageAt(BOUNDARIES[0] - 1e-9)).toBe(0);
    expect(stageAt(BOUNDARIES[0])).toBe(1);
    expect(stageAt(BOUNDARIES[1] - 1e-9)).toBe(1);
    expect(stageAt(BOUNDARIES[1])).toBe(2);
    expect(stageAt(BOUNDARIES[2] - 1e-9)).toBe(2);
    expect(stageAt(BOUNDARIES[2])).toBe(3);
    expect(stageAt(1)).toBe(3);
  });

  it("puts each chapter's hold inside its own stage", () => {
    HOLDS.forEach((hold, i) => expect(stageAt(hold)).toBe(i));
  });

  it("holds still around each hold, so a beat can be read", () => {
    HOLDS.forEach((hold) => {
      const here = flatten(sceneAt(hold));
      const later = flatten(sceneAt(Math.min(hold + 0.01, 1)));
      const earlier = flatten(sceneAt(hold - 0.01));
      here.forEach((value, k) => {
        expect(later[k]).toBeCloseTo(value, 3);
        expect(earlier[k]).toBeCloseTo(value, 3);
      });
    });
  });
});

const hold = (i: number): SceneState => sceneAt(HOLDS[i]!);

describe("beat 1: context", () => {
  const s = hold(0);

  it("rests both plates low and symmetric beside the brief", () => {
    expect(s.ui.z).toBe(POSE.rest.z);
    expect(s.api.z).toBe(POSE.rest.z);
    expect(s.ui.x).toBe(-POSE.rest.x);
    expect(s.api.x).toBe(POSE.rest.x);
  });

  it("owns nothing yet", () => {
    expect(s.edge).toBe(0);
    expect(s.footprint).toBe(0);
    expect(s.tab.opacity).toBe(0);
    expect(s.token.opacity).toBe(0);
    expect(s.handoff.opacity).toBe(0);
  });

  it("shows both plates reading the brief", () => {
    expect(s.reads.draw).toBe(1);
    expect(s.reads.opacity).toBe(1);
  });

  it("names the agents and the brief from the very first frame", () => {
    expect(sceneAt(0).agentLabel).toBe(1);
    expect(sceneAt(0).briefLabel).toBe(1);
  });

  it("has settled the shared plane", () => {
    expect(s.sharedLift).toBe(0);
    expect(sceneAt(0).sharedLift).toBeGreaterThan(0);
  });

  it("shows nothing of the reading lines until the plane has settled under them", () => {
    grid.filter((p) => sceneAt(p).sharedLift > 0.5).forEach((p) => expect(sceneAt(p).reads.opacity).toBe(0));
    expect(sceneAt(0).reads.opacity).toBe(0);
    expect(sceneAt(0).reads.draw).toBe(0);
  });
});

describe("beat 2: claims", () => {
  const s = hold(1);

  it("lifts and separates by tens of world units", () => {
    const rest = hold(0);
    expect(s.api.x - rest.api.x).toBeGreaterThan(60);
    expect(rest.ui.x - s.ui.x).toBeGreaterThan(60);
    expect(s.ui.z - rest.ui.z).toBeGreaterThan(60);
  });

  it("lights the ownership edges, footprints and filenames", () => {
    expect(s.edge).toBe(1);
    expect(s.footprint).toBe(1);
    expect(s.tab.out).toBe(1);
    expect(s.tab.opacity).toBe(1);
  });

  it("has dropped the shared reading lines", () => {
    expect(s.reads.opacity).toBe(0);
  });

  it("hovers only here, and never while the plates are joined by the path", () => {
    expect(s.hover).toBe(1);
    [0, 2, 3].forEach((i) => expect(hold(i).hover).toBe(0));
    grid.filter((p) => p >= 0.53).forEach((p) => expect(sceneAt(p).hover).toBe(0));
  });
});

describe("beat 3: handoff", () => {
  const s = hold(2);

  it("has drawn the whole path and docked the token on the UI plate", () => {
    expect(s.handoff.draw).toBe(1);
    expect(s.token.opacity).toBe(1);
    expect(s.token.x).toBeCloseTo(s.ui.x + TOKEN_OFFSET.ui, 6);
    expect(s.token.z).toBeCloseTo(s.ui.z + AGENT_THICKNESS + TOKEN_THICKNESS, 6);
  });

  it("keeps ownership visible", () => {
    expect(s.edge).toBe(1);
    expect(s.footprint).toBe(1);
  });

  it("moves the token monotonically from API to UI, bound to p", () => {
    const flight = grid.filter((p) => p >= 0.56 && p <= 0.69).map((p) => sceneAt(p).token.x);
    flight.slice(1).forEach((x, i) => expect(x).toBeLessThanOrEqual(flight[i]!));
    expect(flight[0]).toBeCloseTo(POSE.claim.x + TOKEN_OFFSET.api, 1);
    expect(flight[flight.length - 1]).toBeCloseTo(-POSE.claim.x + TOKEN_OFFSET.ui, 1);
  });

  it("keeps the line ahead of the token until the end", () => {
    grid
      .filter((p) => p > 0.56 && p < 0.69)
      .forEach((p) => {
        const s2 = sceneAt(p);
        const t = (POSE.claim.x + TOKEN_OFFSET.api - s2.token.x) / (2 * POSE.claim.x + TOKEN_OFFSET.api - TOKEN_OFFSET.ui);
        expect(s2.handoff.draw).toBeGreaterThanOrEqual(t - 0.02);
      });
  });

  it("names the token before it leaves its plate, and for its whole flight", () => {
    const leaving = grid.find((p) => sceneAt(p).token.x < sceneAt(0.55).token.x)!;
    expect(sceneAt(leaving).token.label).toBe(1);
    grid.filter((p) => p >= leaving && p <= 0.785).forEach((p) => expect(sceneAt(p).token.label).toBe(1));
  });

  it("rides the line on its underside, never lower than the plate it leaves", () => {
    expect(sceneAt(0.55).token.z - TOKEN_THICKNESS).toBeCloseTo(handoffPoint(0)[2], 6);
    expect(sceneAt(0.75).token.z - TOKEN_THICKNESS).toBeCloseTo(handoffPoint(1)[2], 6);
  });

  it("keeps the docked state for at least 250px of a 900px-tall screen", () => {
    const sectionHeights = 4;
    const distance = (sectionHeights - 1) * 900;
    const still = (p: number) => flatten(sceneAt(p)).join() === flatten(sceneAt(0.75)).join();
    const range = grid.filter(still);
    expect((range[range.length - 1]! - range[0]!) * distance).toBeGreaterThanOrEqual(250);
  });

  it("never lifts the token's label above the height it docks at, by more than a few units", () => {
    const tip = (p: number) => project(...handoffPoint(p))[1] - TOKEN_THICKNESS - TOKEN_MAST;
    const docked = tip(1);
    grid.forEach((f) => expect(tip(f)).toBeGreaterThanOrEqual(docked - 4));
  });
});

describe("beat 4: review", () => {
  const s = hold(3);

  it("docks the pair side by side on the base", () => {
    expect(s.ui).toEqual(POSE.dock.ui);
    expect(s.api).toEqual(POSE.dock.api);
    expect(s.ui.z).toBe(GROUND_TOP);
  });

  it("keeps ownership present but calmer", () => {
    expect(s.edge).toBeGreaterThan(0.4);
    expect(s.edge).toBeLessThan(1);
    expect(s.footprint).toBeGreaterThan(0.4);
  });

  it("shows the review frame and retires the handoff", () => {
    expect(s.bracket.opacity).toBe(1);
    expect(s.bracket.drop).toBe(0);
    expect(s.handoff.opacity).toBe(0);
    expect(s.token.label).toBe(0);
  });

  it("keeps the token on the UI plate, as evidence of the handoff", () => {
    expect(s.token.opacity).toBe(1);
    expect(s.token.x).toBeCloseTo(s.ui.x + TOKEN_OFFSET.ui, 6);
  });

  it("drops the token's leader with its word, leaving a plain token", () => {
    expect(s.token.label).toBe(0);
    grid.filter((p) => p >= 0.81).forEach((p) => expect(sceneAt(p).token.label).toBe(0));
  });
});

describe("the way home", () => {
  const halfWidth = 72;

  it("shows the bracket only once the plates have landed on the base it is printed on", () => {
    grid
      .filter((p) => sceneAt(p).bracket.opacity > 0)
      .forEach((p) => {
        const s = sceneAt(p);
        expect(s.ui.z - GROUND_TOP).toBeLessThan(1);
        expect(s.api.z - GROUND_TOP).toBeLessThan(1);
      });
  });

  it("moves no faster than about twice the scroll at 900 tall", () => {
    const distance = 3 * 900;
    const sceneScale = 0.93;
    const step = 0.0005;
    for (let p = 0.79; p < 0.94; p += step) {
      const [a, b] = [sceneAt(p), sceneAt(p + step)];
      for (const who of ["ui", "api"] as const) {
        const [ax, ay] = project(a[who].x, a[who].y, a[who].z);
        const [bx, by] = project(b[who].x, b[who].y, b[who].z);
        expect((Math.hypot(bx - ax, by - ay) * sceneScale) / (step * distance)).toBeLessThan(2.05);
      }
    }
  });

  it("never passes through the shared plane", () => {
    grid.forEach((p) => {
      const { ui, api } = sceneAt(p);
      for (const plate of [ui, api]) {
        const overPlane = plate.y - halfWidth < SHARED_BOX.y1 && plate.y + halfWidth > SHARED_BOX.y0;
        if (overPlane) expect(plate.z).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // The mark's on-screen hull, and each plate's top diamond at the same moment.
  const markCentre = project(PRINT.x + PRINT_LAYOUT.markV, PRINT.y - PRINT_LAYOUT.markU);

  it("never covers the printed mark, at any p", () => {
    const r = PRINT_LAYOUT.markR;
    const hull = [
      [-1, 0],
      [-0.5, -0.87],
      [0.5, -0.87],
      [1, 0],
      [0.5, 0.87],
      [-0.5, 0.87],
    ].map(([lx, ly]) => {
      const u = lx! * r;
      const v = ly! * r;
      return [markCentre[0] + u + v, markCentre[1] + (v - u) / 2] as const;
    });

    grid.forEach((p) => {
      const s = sceneAt(p);
      for (const plate of [s.ui, s.api]) {
        const [cx, cy] = project(plate.x, plate.y, plate.z + AGENT_THICKNESS);
        for (const [hx, hy] of hull) {
          // Inside the diamond |dx|/2 + |dy| < half-height.
          const inside = Math.abs(hx - cx) / 2 + Math.abs(hy - cy) < halfWidth;
          expect(inside).toBe(false);
        }
      }
    });
  });
});

describe("helpers", () => {
  it("clamp", () => {
    expect(clamp(-1)).toBe(0);
    expect(clamp(2)).toBe(1);
    expect(clamp(0.4)).toBe(0.4);
    expect(clamp(5, 0, 3)).toBe(3);
  });
});
