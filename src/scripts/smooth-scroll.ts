// Eased page scrolling with GSAP ScrollSmoother. The page keeps its native scroll
// position, so scroll listeners keep working; only what's drawn trails behind it.
// Off under reduced motion and on touch, where native scrolling feels best.
//
// The content sits in a fixed wrapper, so the browser can no longer jump to an element
// by itself: in-page links and scrollIntoView go through scrollToElement instead.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollSmoother } from "gsap/ScrollSmoother";
import { motion } from "./motion";
import { onPage } from "./page";

gsap.registerPlugin(ScrollTrigger, ScrollSmoother);

const root = document.documentElement;
let smoother: ScrollSmoother | undefined;

/** Scroll an element into view, eased when the smoother is running. */
export function scrollToElement(element: Element, block: "start" | "center" = "start") {
  if (!smoother) {
    element.scrollIntoView({ block, behavior: motion.ambient ? "smooth" : "auto" });
    return;
  }
  smoother.scrollTo(element, true, block === "center" ? "center center" : "top top");
}

const onLinkClick = (event: MouseEvent) => {
  if (!smoother || event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href^="#"]');
  const id = link?.hash.slice(1);
  const target = id ? document.getElementById(decodeURIComponent(id)) : null;
  if (!target) return;
  event.preventDefault();
  scrollToElement(target);
  // Keep keyboard focus moving with the link, as the native jump would.
  if (target.tabIndex >= 0 || target.hasAttribute("tabindex")) target.focus({ preventScroll: true });
  history.pushState(null, "", link!.hash);
};

// Focus, find-in-page and hash jumps make the browser scroll the clipped wrapper itself,
// which would leave the page out of step. Hand that offset to the smoother instead.
const onWrapperScroll = (event: Event) => {
  const wrapper = event.currentTarget as HTMLElement;
  if (!smoother || wrapper.scrollTop === 0) return;
  const target = smoother.scrollTop() + wrapper.scrollTop;
  wrapper.scrollTop = 0;
  smoother.scrollTo(target, false);
};

onPage(() => {
  const sync = () => {
    if (motion.ambient && !smoother) {
      smoother = ScrollSmoother.create({
        wrapper: "#smooth-wrapper",
        content: "#smooth-content",
        smooth: 1.1,
        smoothTouch: false,
        effects: false,
      });
      root.classList.add("has-smoother");
    } else if (!motion.ambient && smoother) {
      smoother.kill();
      smoother = undefined;
      root.classList.remove("has-smoother");
    }
  };

  sync();
  const unsubscribe = motion.subscribe(sync);
  const wrapper = document.querySelector<HTMLElement>("#smooth-wrapper");
  document.addEventListener("click", onLinkClick);
  wrapper?.addEventListener("scroll", onWrapperScroll);

  // Arriving on a #link: jump to it once the page has loaded and been measured.
  const landing = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  let landFrame = 0;
  const land = () => {
    landFrame = requestAnimationFrame(() => {
      if (smoother && landing) smoother.scrollTo(landing, false, "top top");
    });
  };
  if (landing) {
    if (document.readyState === "complete") land();
    else window.addEventListener("load", land, { once: true });
  }

  return () => {
    unsubscribe();
    window.removeEventListener("load", land);
    cancelAnimationFrame(landFrame);
    document.removeEventListener("click", onLinkClick);
    wrapper?.removeEventListener("scroll", onWrapperScroll);
    smoother?.kill();
    smoother = undefined;
    root.classList.remove("has-smoother");
  };
});
