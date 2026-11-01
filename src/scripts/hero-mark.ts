// The hero ring's state, whatever is drawing it: the bonds (through MarkFeedback) and the
// success glide. The glass ring (hero-scene.ts) and the flat SVG ring (hero-flat-ring.ts)
// both read this; only hero.ts's frame loop advances it, so the bonds never step twice.
//
// The flat SVG rings are also the layout. Desktop's large ring is cropped by the window's
// right edge in pure CSS; the WebGL ring reads that box every frame, glide included.
import { motion } from "./motion";
import { R, VIEWBOX } from "../lib/mark";
import type { MarkFeedback } from "../lib/mark-feedback";

const GLIDE_MS = 1100;
const GLIDE_EASE = "cubic-bezier(.65,0,.35,1)";
// The check starts forming once the glide has mostly landed.
const FINISH_AFTER_MS = 650;

/** Where a layout ring is right now, in client pixels. */
export interface RingBox {
  cx: number;
  cy: number;
  /** The hexagon's circumradius. */
  radius: number;
}

/** Reads a flat ring's box. Its viewBox is centred on the ring, so the box centre is the ring's. */
export function ringBox(svg: SVGSVGElement | undefined): RingBox | undefined {
  const rect = svg?.getBoundingClientRect();
  if (!rect?.width) return undefined;
  return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, radius: (R * rect.width) / VIEWBOX.w };
}

export interface MarkController {
  readonly feedback: MarkFeedback;
  /** Something is still changing: keep drawing frames. */
  readonly animating: boolean;
  turn(direction: number): void;
  setWorking(working: boolean): void;
  settle(): void;
  advance(dt: number): void;
  motionChanged(): void;
  destroy(): void;
}

export function createMarkController(
  feedback: MarkFeedback,
  wide: SVGSVGElement | undefined,
  desktop: MediaQueryList,
  wake: () => void,
): MarkController {
  let glided = false;
  let glideUntil = 0;
  let glideAnimation: Animation | undefined;
  let finishTimer = 0;

  // The cropped desktop ring shrinks about its left vertex until all of it is in the
  // window, so the check inside has room. Phones already show the whole ring.
  const glideScale = () => {
    const box = ringBox(wide);
    const field = wide?.parentElement?.getBoundingClientRect();
    if (!box || !field) return 1;
    const left = box.cx - box.radius;
    const gutter = Math.min(96, Math.max(20, field.width * 0.048));
    return Math.max(0.4, Math.min(1, (field.right - gutter - left) / (2 * box.radius)));
  };

  const applyGlide = (animate: boolean) => {
    if (!wide) return;
    // Where it is now, mid-animation included, before anything is reset.
    const from = getComputedStyle(wide).transform;
    glideAnimation?.cancel();
    glideAnimation = undefined;
    wide.style.transform = "";
    wide.style.transformOrigin = `${((VIEWBOX.w / 2 - R) / VIEWBOX.w) * 100}% 50%`;
    const scale = glided ? glideScale() : 1;
    const to = `scale(${scale})`;
    wide.style.transform = scale === 1 ? "" : to;
    if (animate && motion.ambient && desktop.matches) {
      glideAnimation = wide.animate([{ transform: from === "none" ? "scale(1)" : from }, { transform: to }], {
        duration: GLIDE_MS,
        easing: GLIDE_EASE,
      });
      glideUntil = performance.now() + GLIDE_MS;
    }
    wake();
  };

  const resized = new ResizeObserver(() => {
    if (glided) applyGlide(false);
  });
  if (wide?.parentElement) resized.observe(wide.parentElement);
  const switched = () => applyGlide(false);
  desktop.addEventListener("change", switched);

  const finish = () => {
    feedback.finish();
    wake();
  };

  return {
    feedback,
    get animating() {
      return feedback.animating || performance.now() < glideUntil;
    },
    turn(direction) {
      if (glided) {
        glided = false;
        clearTimeout(finishTimer);
        applyGlide(true);
      }
      feedback.hop(direction);
      wake();
    },
    setWorking(working) {
      feedback.setWorking(working);
      wake();
    },
    settle() {
      const needsRoom = desktop.matches && glideScale() < 1;
      glided = true;
      applyGlide(true);
      clearTimeout(finishTimer);
      if (needsRoom && motion.ambient) finishTimer = window.setTimeout(finish, FINISH_AFTER_MS);
      else finish();
    },
    advance(dt) {
      // Nothing may move: every change lands at once.
      feedback.update(dt, motion.ambient);
    },
    motionChanged() {
      if (!motion.ambient) applyGlide(false);
      wake();
    },
    destroy() {
      clearTimeout(finishTimer);
      glideAnimation?.cancel();
      resized.disconnect();
      desktop.removeEventListener("change", switched);
    },
  };
}
