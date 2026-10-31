// The mark responds immediately through a light image transform. A ready WebGL scene
// replaces it, and a lost or unavailable context returns to that interactive fallback.
import { motion } from "./motion";
import { MarkFeedback } from "../lib/mark-feedback";
import { createPosterMotion } from "./hero-poster-motion";
import { onPage } from "./page";
import { createPhoneTilt, type TiltState } from "../lib/phone-tilt";
import type { HeroScene } from "./hero-scene";

const DRAG_THRESHOLD = 6;
const CONTEXT: WebGLContextAttributes = {
  alpha: true,
  antialias: true,
  premultipliedAlpha: true,
  stencil: false,
  powerPreference: "low-power",
};

onPage(() => {
  const stage = document.querySelector<HTMLElement>("[data-hero-stage]");
  const poster = stage?.querySelector<HTMLImageElement>("img");
  if (!stage || !poster) return;

  const stopping = new AbortController();
  const { signal } = stopping;
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.opacity = "0";

  const feedback = new MarkFeedback();
  const fallback = createPosterMotion(stage, poster, feedback);
  let scene: HeroScene = fallback;
  let gpuScene: HeroScene | undefined;
  let interactive = false;
  let onScreen = false;
  const hoverDevice = window.matchMedia("(hover: hover) and (pointer: fine)");

  // Pointer input. A press only becomes a drag past the threshold, and a drag is never a click.
  interface Press {
    id: number;
    x: number;
    y: number;
  }
  let press: Press | undefined;
  let dragging = false;
  let dragged = false;

  const tiltButton = document.querySelector<HTMLButtonElement>("[data-hero-tilt]");
  const touchDevice = window.matchMedia("(any-pointer: coarse)");
  const sensor = window.DeviceOrientationEvent as (typeof DeviceOrientationEvent & {
    requestPermission?: () => Promise<string>;
  }) | undefined;
  let tiltState: TiltState = "off";
  const updateTiltControl = () => {
    if (!tiltButton) return;
    tiltButton.hidden = !sensor || !window.isSecureContext || !touchDevice.matches || motion.reduced;
    tiltButton.disabled = !motion.ambient || tiltState === "requesting" || tiltState === "denied";
    tiltButton.setAttribute("aria-pressed", String(tiltState === "on"));
    tiltButton.textContent = { off: "Enable tilt", requesting: "Enabling tilt…", on: "Tilt on", denied: "Tilt unavailable" }[tiltState];
  };
  const phoneTilt = createPhoneTilt({
    events: window,
    requestPermission: sensor?.requestPermission ? () => sensor.requestPermission!() : undefined,
    screenAngle: () => window.screen.orientation?.angle ?? (typeof window.orientation === "number" ? window.orientation : 0),
    onTilt: (x, y) => { if (!press) scene.hover(x, y); },
    onReset: () => scene.leave(),
    onState: state => {
      tiltState = state;
      updateTiltControl();
    },
  });
  tiltButton?.addEventListener("click", () => {
    if (!motion.ambient) return;
    if (tiltState === "on") phoneTilt.disable();
    else void phoneTilt.enable();
  }, { signal });
  updateTiltControl();
  // Browsers without an explicit permission API can start as soon as the logo is visible.
  if (sensor && window.isSecureContext && touchDevice.matches && !sensor.requestPermission && motion.ambient) void phoneTilt.enable();

  const endPress = () => {
    press = undefined;
    if (!dragging) return;
    dragging = false;
    delete stage.dataset.dragging;
    scene?.dragEnd();
  };

  const upgrade = () => {
    interactive = true;
    stage.setAttribute("role", "button");
    stage.tabIndex = 0;
    stage.setAttribute("aria-label", "Move the Covalent mark");
    stage.dataset.interactive = "";
    stage.dataset.motionLive = "";
  };

  const downgrade = () => {
    endPress();
    interactive = false;
    stage.removeAttribute("role");
    // No longer a tab stop either way, but removing the attribute would blur a focused stage.
    if (document.activeElement === stage) stage.tabIndex = -1;
    else stage.removeAttribute("tabindex");
    stage.removeAttribute("aria-label");
    delete stage.dataset.interactive;
    delete stage.dataset.motionLive;
  };

  const turn = () => {
    if (!interactive) return;
    scene?.turn();
  };

  const normalised = (event: PointerEvent) => {
    const rect = stage.getBoundingClientRect();
    return [((event.clientX - rect.left) / rect.width) * 2 - 1, ((event.clientY - rect.top) / rect.height) * 2 - 1] as const;
  };

  stage.addEventListener(
    "pointerdown",
    (event) => {
      if (!interactive || !event.isPrimary || event.button !== 0) return;
      press = { id: event.pointerId, x: event.clientX, y: event.clientY };
      dragged = false;
      // Taken now, not at the threshold: a press can leave the stage within one sample, and
      // its release has to come back here wherever it lands.
      stage.setPointerCapture(event.pointerId);
    },
    { signal },
  );

  // Safari scrolls the page under any press dragged past the window's edge, which would carry
  // the mark away mid-drag. Only cancelling the press stops that, and that also cancels the
  // focus a press gives, so it is given back here, without the ring a mouse press never shows.
  stage.addEventListener(
    "mousedown",
    (event) => {
      if (!interactive || event.button !== 0) return;
      event.preventDefault();
      stage.focus({ preventScroll: true, focusVisible: false });
    },
    { signal },
  );

  const followPress = (event: PointerEvent, held: Press) => {
    if (motion.reduced) return; // nothing to drag, so any press stays a click
    const dx = event.clientX - held.x;
    const dy = event.clientY - held.y;
    if (dragging) {
      scene?.drag(dx, dy);
    } else if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
      dragging = true;
      dragged = true;
      // Measured from here, so crossing the threshold does not make the mark jump.
      held.x = event.clientX;
      held.y = event.clientY;
      stage.dataset.dragging = "";
      scene?.dragStart();
    }
  };

  stage.addEventListener(
    "pointermove",
    (event) => {
      if (!interactive) return;
      // A release nothing reported, such as one a context menu swallowed: a drag never
      // outlives the button that started it.
      if (press?.id === event.pointerId && event.buttons === 0) endPress();
      if (press?.id === event.pointerId) followPress(event, press);
      else if (event.pointerType === "mouse" && hoverDevice.matches) scene?.hover(...normalised(event));
    },
    { signal },
  );

  const released = (event: PointerEvent) => {
    if (event.pointerId === press?.id) endPress();
  };
  window.addEventListener("pointerup", released, { signal });
  window.addEventListener("pointercancel", released, { signal });
  stage.addEventListener(
    "pointerleave",
    () => {
      if (interactive) scene?.leave();
    },
    { signal },
  );

  // Also how a screen reader's activation arrives, so this is the one path for a press.
  stage.addEventListener(
    "click",
    () => {
      if (dragged) dragged = false;
      else turn();
    },
    { signal },
  );

  stage.addEventListener(
    "keydown",
    (event) => {
      if (!interactive || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      if (!event.repeat) turn();
    },
    { signal },
  );

  // Only ever observes the forms; nothing here reaches back into them. Tracked per form,
  // because typing in one can reset it to idle while the other is still waiting on its answer.
  const submitting = new Set<string>();
  const emailInputs = [...document.querySelectorAll<HTMLInputElement>('form[data-waitlist] input[type="email"]')];
  const previousValues = new WeakMap(emailInputs.map(input => [input, input.value] as const));
  document.addEventListener("beforeinput", event => {
    if (event.target instanceof HTMLInputElement) previousValues.set(event.target, event.target.value);
  }, { signal });
  document.addEventListener("input", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "email" || !input.closest("form[data-waitlist]")) return;
    const deleting = (event instanceof InputEvent && event.inputType.startsWith("delete")) || input.value.length < (previousValues.get(input)?.length ?? 0);
    scene.turn(deleting ? -1 : 1);
    stage.dataset.feedbackDirection = deleting ? "backward" : "forward";
    emailInputs.forEach(field => previousValues.set(field, field.value));
    if (submitting.size) scene.setWorking(true);
    stage.dataset.feedback = "typing";
  }, { signal });
  document.addEventListener(
    "waitlist:state",
    (event) => {
      const { source, state } = (event as CustomEvent<{ source: string; state: string }>).detail;
      const wasWaiting = submitting.has(source);
      if (state === "submitting") submitting.add(source);
      else submitting.delete(source);
      scene.setWorking(submitting.size > 0);
      stage.dataset.feedback = submitting.size ? "working" : feedback.status === "done" ? "done" : "idle";
      if (wasWaiting && submitting.size === 0 && (state === "accepted" || state === "confirm")) {
        scene.settle();
        stage.dataset.feedback = "done";
      }
    },
    { signal },
  );

  window.addEventListener("scroll", () => scene?.scrolled(), { passive: true, signal });

  const syncActive = () => {
    const visible = onScreen && !document.hidden;
    scene.setActive(visible);
    phoneTilt.setActive(visible && motion.ambient && touchDevice.matches);
  };
  const unsubscribe = motion.subscribe(() => {
    scene.motionChanged();
    syncActive();
    updateTiltControl();
  });
  touchDevice.addEventListener("change", () => { syncActive(); updateTiltControl(); }, { signal });
  document.addEventListener("visibilitychange", syncActive, { signal });
  // A page kept in the back/forward cache must not spin there, and picks up where it left off.
  window.addEventListener("pagehide", () => { scene.setActive(false); phoneTilt.setActive(false); }, { signal });
  window.addEventListener(
    "pageshow",
    (event) => {
      if (event.persisted) syncActive();
    },
    { signal },
  );

  const load = async () => {
    if (signal.aborted) return;
    // Asked for here rather than by three, so a browser without WebGL downloads nothing.
    try {
      const gl = canvas.getContext("webgl2", CONTEXT);
      if (!gl) { fallback.startAmbient(); return; }
      const { createHeroScene } = await import("./hero-scene");
      if (signal.aborted) return;
      stage.append(canvas);
      const built = await createHeroScene({
        stage,
        canvas,
        gl,
        poster,
        feedback,
        onLost: () => {
          gpuScene?.setActive(false);
          // A lost GPU stays on the lightweight renderer for this visit; no flashing retries.
          queueMicrotask(() => { gpuScene?.destroy(); gpuScene = undefined; canvas.remove(); });
          scene = fallback;
          stage.dataset.renderer = "poster";
          fallback.startAmbient();
          fallback.reveal();
          upgrade();
          syncActive();
        },
        onLive: () => {
          fallback.setActive(false);

          scene = gpuScene ?? fallback;
          stage.dataset.renderer = "webgl";
          upgrade();
          syncActive();
        },
      });
      if (signal.aborted) {
        built.destroy();
        return;
      }
      gpuScene = built;
      const heldTransform = stage.style.transform;
      fallback.setActive(false);
      stage.style.transform = "";
      if (heldTransform && motion.ambient) stage.animate([{ transform: heldTransform }, { transform: "none" }], { duration: 500, easing: "cubic-bezier(.22,1,.36,1)" });
      scene = built;
      // A form can already be waiting, and its event went by before there was a scene to hear it.
      scene.setWorking(submitting.size > 0);
      if (import.meta.env.DEV) {
        const dev = window as unknown as Record<string, unknown>;
        dev.__hero = scene;
        if (new URLSearchParams(location.search).has("mark-poster")) {
          dev.__markPoster = (size: number) => built.capture?.(size);
          return;
        }
      }
      scene.reveal();
      syncActive();
    } catch {
      if (signal.aborted) return;
      canvas.remove();
      scene = fallback;
      stage.dataset.renderer = "poster";
      fallback.startAmbient();
      fallback.reveal();
      upgrade();
      syncActive();
    }
  };

  // Waits for the stage to come near the screen, then for a free moment after first paint.
  const started = new IntersectionObserver(
    ([entry]) => {
      if (!entry?.isIntersecting) return;
      started.disconnect();
      const run = () => void load();
      if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 900 });
      else setTimeout(run, 120);
    },
    { rootMargin: "300px" },
  );
  started.observe(stage);

  const visibility = new IntersectionObserver(
    ([entry]) => {
      onScreen = entry?.isIntersecting ?? false;
      syncActive();
    },
    { rootMargin: "48px" },
  );
  visibility.observe(stage);
  stage.dataset.renderer = "poster";
  upgrade();
  fallback.reveal();

  return () => {
    stopping.abort();
    started.disconnect();
    visibility.disconnect();
    unsubscribe();
    phoneTilt.destroy();
    gpuScene?.destroy();
    fallback.destroy();
    delete stage.dataset.renderer;
    canvas.remove();
    poster.style.visibility = "";
    poster.style.opacity = "";
    downgrade();
  };
});
