import { afterEach, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ create: vi.fn(), setup: undefined as undefined | (() => unknown) }));
vi.mock("gsap", () => ({ gsap: { registerPlugin: vi.fn() } }));
vi.mock("gsap/ScrollTrigger", () => ({ ScrollTrigger: {} }));
vi.mock("gsap/ScrollSmoother", () => ({ ScrollSmoother: { create: hooks.create } }));
vi.mock("./motion", () => ({ motion: { ambient: true, subscribe: () => () => {} } }));
vi.mock("./page", () => ({ onPage: (setup: () => unknown) => { hooks.setup = setup; } }));

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks(); });

it("notifies the hero during the smooth tail and at rest without another native scroll event", async () => {
  const windowTarget = new EventTarget();
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("location", { hash: "" });
  vi.stubGlobal("document", {
    documentElement: { classList: { add: vi.fn() } },
    querySelector: () => null,
    addEventListener: vi.fn(),
  });
  hooks.create.mockReturnValue({});
  await import("./smooth-scroll");
  hooks.setup!();
  const visualScroll = vi.fn();
  const nativeScroll = vi.fn();
  windowTarget.addEventListener("covalent:visual-scroll", visualScroll);
  windowTarget.addEventListener("scroll", nativeScroll);
  const options = hooks.create.mock.calls[0]![0];
  expect(options.onUpdate).toBeTypeOf("function");
  expect(options.onStop).toBeTypeOf("function");
  options.onUpdate();
  options.onUpdate();
  options.onStop();
  expect(visualScroll).toHaveBeenCalledTimes(3);
  expect(nativeScroll).not.toHaveBeenCalled();
});
