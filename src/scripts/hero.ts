// The hero: the Covalent ring over a faint honeycomb of benzene rings. As the page
// arrives, two waves from the ring raise the honeycomb and then lay it flat again;
// afterwards the cursor brings it up wherever it moves. Typing hops the ring's inner bonds, deleting
// turns them back, a pending signup spins them into a ring, and an accepted one brings
// the whole ring into view and forms a check. The ring is decorative; the form is the
// only thing to interact with.
//
// One frame loop here advances the ring's state (hero-mark.ts) and hands it to whichever
// renderer is showing: the glass in WebGL (hero-scene.ts), or the page's own flat SVG
// ring (hero-flat-ring.ts) where WebGL can't run.
import { motion } from "./motion";
import { MarkFeedback } from "../lib/mark-feedback";
import { createMarkController, ringBox } from "./hero-mark";
import { createFlatRings } from "./hero-flat-ring";
import { onPage } from "./page";
import type { HeroScene } from "./hero-scene";

const MAX_DT = 1 / 20;
const CONTEXT: WebGLContextAttributes = {
  alpha: true,
  antialias: true,
  premultipliedAlpha: true,
  stencil: false,
  powerPreference: "low-power",
};
// The page's own honeycomb starts its CSS waves this long after load (Hero.astro). WebGL
// that is ready before then runs the waves itself.
const CSS_RIPPLE_DELAY = 900;

onPage(() => {
  const hero = document.querySelector<HTMLElement>(".hero");
  const field = document.querySelector<HTMLElement>("[data-hero-field]");
  const lattice = document.querySelector<SVGSVGElement>("svg[data-lattice]");
  const svgs = [...document.querySelectorAll<SVGSVGElement>("svg[data-ring]")];
  if (!hero || !field || !svgs.length) return;

  const stopping = new AbortController();
  const { signal } = stopping;
  const desktop = window.matchMedia("(min-width: 1000px)");
  const wide = svgs.find((svg) => svg.dataset.ring === "wide");
  const compact = svgs.find((svg) => svg.dataset.ring === "compact");
  const layoutRing = () => (desktop.matches ? wide : compact);

  const feedback = new MarkFeedback();
  const flat = createFlatRings(svgs);
  const ctrl = createMarkController(feedback, wide, desktop, () => schedule());

  // The wave clears the honeycomb from the ring outward, wherever the ring is.
  const aimRipple = () => {
    const box = ringBox(layoutRing());
    const area = field.getBoundingClientRect();
    if (!lattice || !box || !area.width) return;
    lattice.style.setProperty("--cx", `${box.cx - area.left}px`);
    lattice.style.setProperty("--cy", `${box.cy - area.top}px`);
  };
  aimRipple();

  // ---- WebGL ----
  let scene: HeroScene | undefined;
  let canvas: HTMLCanvasElement | undefined;
  const noGl = import.meta.env.DEV && new URLSearchParams(location.search).has("nogl");

  const useFlat = () => {
    flat.setState("shown");
    flat.draw(feedback);
  };

  const dropGl = () => {
    const gone = scene;
    scene = undefined;
    useFlat();
    // Whatever the honeycomb was doing, it is over: the page's copy has long finished.
    if (lattice) lattice.dataset.hidden = "";
    // A lost GPU stays on the flat ring for this visit; no flashing retries.
    queueMicrotask(() => {
      gone?.destroy();
      canvas?.remove();
      canvas = undefined;
    });
  };

  const loadGl = async () => {
    const surface = document.createElement("canvas");
    surface.setAttribute("aria-hidden", "true");
    // Asked for here rather than in the chunk, so a browser without WebGL downloads nothing.
    const gl = noGl ? null : surface.getContext("webgl2", CONTEXT);
    if (!gl) {
      useFlat();
      return;
    }
    // The glass ring takes the flat ring's place; the flat one stays as invisible layout.
    flat.setState("gl");
    try {
      const { createHeroScene } = await import("./hero-scene");
      if (signal.aborted) return;
      field.append(surface);
      canvas = surface;
      const built = await createHeroScene({
        canvas: surface,
        gl,
        field,
        feedback,
        ring: () => ringBox(layoutRing()),
        copy: [...hero.querySelectorAll(".hero-title, .hero-form")],
        cell: Number(lattice?.dataset.cell) || 40,
        wake: () => schedule(),
        onLost: dropGl,
      });
      if (signal.aborted) {
        built.destroy();
        return;
      }
      scene = built;
      // Early enough, the glass takes over the page's honeycomb and runs the wave itself;
      // late, the page's CSS wave has started, so it finishes and the glass arrives without one.
      const css = lattice?.getAnimations()[0];
      const early = !css || Number(css.currentTime ?? 0) < CSS_RIPPLE_DELAY - 100;
      if (early) css?.pause();
      scene.reveal(early ? "ripple" : "none", () => {
        if (lattice && early) lattice.dataset.hidden = "";
      });
      schedule();
    } catch {
      if (signal.aborted) return;
      dropGl();
    }
  };

  // ---- frame loop ----
  let frame = 0;
  let last = 0;
  let active = true;

  const draw = (dt: number) => {
    if (scene) scene.frame(dt);
    else flat.draw(feedback);
  };
  const needsFrame = () => ctrl.animating || !!scene?.needsFrame;

  const tick = (now: number) => {
    frame = 0;
    const dt = Math.min(MAX_DT, Math.max(0, (now - last) / 1000));
    last = now;
    ctrl.advance(dt);
    draw(dt);
    if (needsFrame()) request();
  };

  const request = () => {
    if (!frame && active) frame = requestAnimationFrame(tick);
  };

  function schedule() {
    if (frame || !active) return;
    if (!motion.ambient && !scene?.needsFrame) {
      // Nothing may move: every change lands at once, in one draw.
      ctrl.advance(0);
      draw(0);
      return;
    }
    last = performance.now();
    request();
  }

  const setActive = (value: boolean) => {
    active = value;
    if (!active && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else if (active) schedule();
  };

  // ---- the forms ----
  // Only ever observes them; nothing here reaches back in. Tracked per form, because typing
  // in one can reset it to idle while the other is still waiting on its answer.
  const submitting = new Set<string>();
  const emailInputs = [...document.querySelectorAll<HTMLInputElement>('form[data-waitlist] input[type="email"]')];
  const previousValues = new WeakMap(emailInputs.map((input) => [input, input.value] as const));
  document.addEventListener(
    "beforeinput",
    (event) => {
      if (event.target instanceof HTMLInputElement) previousValues.set(event.target, event.target.value);
    },
    { signal },
  );
  document.addEventListener(
    "input",
    (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "email" || !input.closest("form[data-waitlist]")) return;
      const deleting =
        (event instanceof InputEvent && event.inputType.startsWith("delete")) ||
        input.value.length < (previousValues.get(input)?.length ?? 0);
      ctrl.turn(deleting ? -1 : 1);
      emailInputs.forEach((one) => previousValues.set(one, one.value));
      if (submitting.size) ctrl.setWorking(true);
    },
    { signal },
  );
  document.addEventListener(
    "waitlist:state",
    (event) => {
      const { source, state } = (event as CustomEvent<{ source: string; state: string }>).detail;
      const wasWaiting = submitting.has(source);
      if (state === "submitting") submitting.add(source);
      else submitting.delete(source);
      ctrl.setWorking(submitting.size > 0);
      if (wasWaiting && submitting.size === 0 && (state === "accepted" || state === "confirm")) ctrl.settle();
    },
    { signal },
  );

  // ---- the cursor ----
  window.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType !== "mouse" || !scene) return;
      scene.hover(event.clientX, event.clientY);
      schedule();
    },
    { passive: true, signal },
  );
  document.documentElement.addEventListener("pointerleave", () => scene?.leave(), { signal });

  // ---- visibility and settings ----
  let onScreen = true;
  const syncActive = () => setActive(onScreen && !document.hidden);
  const unsubscribe = motion.subscribe(() => {
    ctrl.motionChanged();
    scene?.motionChanged();
    schedule();
  });
  desktop.addEventListener("change", () => schedule(), { signal });
  document.addEventListener("visibilitychange", syncActive, { signal });
  // A page kept in the back/forward cache must not animate there, and picks up where it left off.
  window.addEventListener("pagehide", () => setActive(false), { signal });
  window.addEventListener(
    "pageshow",
    (event) => {
      if (event.persisted) syncActive();
    },
    { signal },
  );
  const visibility = new IntersectionObserver(
    ([entry]) => {
      onScreen = entry?.isIntersecting ?? false;
      syncActive();
    },
    { rootMargin: "48px" },
  );
  visibility.observe(hero);

  // ---- start ----
  void loadGl();

  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__hero = {
      ctrl,
      scrub: (age: number) => scene?.scrub?.(age),
      debug: () => ({
        renderer: scene ? "webgl" : "flat",
        looping: !!frame,
        animating: ctrl.animating,
        rotation: feedback.rotation,
        done: feedback.done,
        gl: scene?.debug(),
      }),
    };
  }

  return () => {
    stopping.abort();
    visibility.disconnect();
    unsubscribe();
    if (frame) cancelAnimationFrame(frame);
    ctrl.destroy();
    scene?.destroy();
    canvas?.remove();
  };
});
