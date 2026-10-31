import { describe, expect, it, vi } from "vitest";
import { createPhoneTilt } from "./phone-tilt";

function setup(requestPermission?: () => Promise<string>) {
  const events = new EventTarget();
  let angle = 0;
  const onTilt = vi.fn(), onReset = vi.fn(), onState = vi.fn();
  const tilt = createPhoneTilt({ events, requestPermission, screenAngle: () => angle, onTilt, onReset, onState });
  const sample = (beta: number | null, gamma: number | null) => {
    const event = new Event("deviceorientation");
    Object.assign(event, { beta, gamma });
    events.dispatchEvent(event);
  };
  tilt.setActive(true);
  return { tilt, sample, onTilt, onReset, onState, rotate: (value: number) => { angle = value; } };
}

describe("phone tilt", () => {
  it("calls permission synchronously in the activation and waits before listening", async () => {
    let grant!: (permission: string) => void;
    const permission = vi.fn(() => new Promise<string>(resolve => { grant = resolve; }));
    const h = setup(permission);
    const enabled = h.tilt.enable();
    expect(permission).toHaveBeenCalledOnce();
    h.sample(45, 0);
    expect(h.onTilt).not.toHaveBeenCalled();
    grant("granted");
    await enabled;
    h.sample(45, 0);
    expect(h.onTilt).toHaveBeenLastCalledWith(0, 0);
    expect(h.onState).toHaveBeenLastCalledWith("on");
  });

  it("calibrates to the held phone and clamps large movements", async () => {
    const h = setup();
    await h.tilt.enable();
    h.sample(50, -10);
    h.sample(64, 4);
    expect(h.onTilt).toHaveBeenLastCalledWith(.5, .5);
    h.sample(120, -80);
    expect(h.onTilt).toHaveBeenLastCalledWith(-1, 1);
  });

  it("wraps pitch across the sensor's angle boundary", async () => {
    const h = setup();
    await h.tilt.enable();
    h.sample(179, 0);
    h.sample(-179, 0);
    expect(h.onTilt).toHaveBeenLastCalledWith(0, 2 / 28);
  });

  it("recalibrates after screen rotation and maps landscape axes", async () => {
    const h = setup();
    await h.tilt.enable();
    h.sample(45, 0);
    h.rotate(90);
    h.sample(0, 45);
    expect(h.onTilt).toHaveBeenLastCalledWith(0, 0);
    h.sample(14, 59);
    const [x, y] = h.onTilt.mock.lastCall!;
    expect(x).toBeCloseTo(.5);
    expect(y).toBeCloseTo(-.5);
  });

  it("ignores unavailable and invalid sensor values", async () => {
    const h = setup();
    await h.tilt.enable();
    h.sample(null, 0);
    h.sample(0, null);
    h.sample(NaN, 0);
    h.sample(0, Infinity);
    expect(h.onTilt).not.toHaveBeenCalled();
    h.sample(45, 0);
    expect(h.onTilt).toHaveBeenLastCalledWith(0, 0);
  });

  it("suspends for pause, reduced motion or visibility and recalibrates on resume", async () => {
    const h = setup();
    await h.tilt.enable();
    h.sample(45, 0);
    h.tilt.setActive(false);
    expect(h.onReset).toHaveBeenCalledOnce();
    h.sample(80, 30);
    expect(h.onTilt).toHaveBeenCalledOnce();
    h.tilt.setActive(true);
    h.sample(80, 30);
    expect(h.onTilt).toHaveBeenLastCalledWith(0, 0);
  });

  it.each(["denied", "error"])("keeps fallback interaction when permission is %s", async result => {
    const permission = vi.fn(() => result === "error" ? Promise.reject(new Error("Unavailable")) : Promise.resolve(result));
    const h = setup(permission);
    await h.tilt.enable();
    await h.tilt.enable();
    expect(permission).toHaveBeenCalledOnce();
    expect(h.onState).toHaveBeenLastCalledWith("denied");
    h.sample(45, 0);
    expect(h.onTilt).not.toHaveBeenCalled();
  });

  it("removes sensor listeners when disabled or destroyed", async () => {
    const h = setup();
    await h.tilt.enable();
    h.sample(45, 0);
    h.tilt.disable();
    h.sample(60, 10);
    expect(h.onTilt).toHaveBeenCalledOnce();
    await h.tilt.enable();
    h.sample(60, 10);
    h.tilt.destroy();
    h.sample(80, 30);
    expect(h.onTilt).toHaveBeenCalledTimes(2);
    expect(h.onReset).toHaveBeenCalledTimes(2);
  });

  it.each(["destroy", "disable"] as const)("ignores a permission result after %s", async action => {
    let grant!: (permission: string) => void;
    const h = setup(() => new Promise<string>(resolve => { grant = resolve; }));
    const pending = h.tilt.enable();
    h.tilt[action]();
    grant("granted");
    await pending;
    h.sample(45, 0);
    expect(h.onTilt).not.toHaveBeenCalled();
    expect(h.onState).not.toHaveBeenCalledWith("on");
  });
});
