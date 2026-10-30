// The header's two behaviours: the hairline once the page has scrolled, and Explore.
//
// Explore is a navigation disclosure, not a dialog. Focus stays free, the page keeps
// scrolling, and moving anywhere else closes it. aria-expanded on the button is the one
// piece of state; the CSS reads it, so nothing else can disagree.
import { motion } from "./motion";
import { onPage } from "./page";

onPage(() => {
  const header = document.querySelector<HTMLElement>("[data-site-header]");
  const explore = header?.querySelector<HTMLElement>("[data-explore]");
  const trigger = explore?.querySelector<HTMLButtonElement>("[data-explore-trigger]");
  const fallback = explore?.querySelector<HTMLElement>("[data-explore-fallback]");
  const panel = explore?.querySelector<HTMLElement>("[data-explore-panel]");
  const scrim = explore?.querySelector<HTMLElement>("[data-explore-scrim]");
  if (!header) return;

  const hairline = new IntersectionObserver(
    ([entry]) => header.toggleAttribute("data-scrolled", !entry?.isIntersecting),
    { rootMargin: "8px 0px 0px 0px" },
  );
  const top = document.getElementById("top");
  if (top) hairline.observe(top);

  // Direct actions jump to their result when motion is paused or reduced.
  const questions = document.getElementById("questions");
  const syncMotion = () => {
    for (const element of [document.documentElement, header, questions]) element?.toggleAttribute("data-instant", !motion.ambient);
  };
  const unsubscribe = motion.subscribe(syncMotion);
  syncMotion();

  // Header and motion behavior still apply when the landing page omits Explore.
  if (!explore || !trigger || !fallback || !panel || !scrim) {
    return () => {
      hairline.disconnect();
      unsubscribe();
    };
  }

  fallback.hidden = true;
  trigger.hidden = false;

  const isOpen = () => trigger.getAttribute("aria-expanded") === "true";
  const setOpen = (open: boolean) => trigger.setAttribute("aria-expanded", String(open));

  const onTrigger = () => setOpen(!isOpen());
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !isOpen()) return;
    setOpen(false);
    trigger.focus();
  };
  const onDocumentClick = (event: MouseEvent) => {
    const target = event.target;
    if (!isOpen() || !(target instanceof Node)) return;
    if (!panel.contains(target) && !trigger.contains(target)) setOpen(false);
  };
  // Touch WebKit only makes a click from a tap on something that listens for one itself, so
  // the document never hears a tap on the scrim, which is most of the outside on a phone.
  const onScrimClick = () => setOpen(false);
  // The browser follows the anchor; this only clears the way.
  const onPanelClick = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest("a")) setOpen(false);
  };
  // No relatedTarget means focus left the window, which says nothing about intent.
  const onFocusOut = (event: FocusEvent) => {
    if (event.relatedTarget instanceof Node && !explore.contains(event.relatedTarget)) setOpen(false);
  };
  // A page restored from the back/forward cache keeps its DOM, open panel included.
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) setOpen(false);
  };

  trigger.addEventListener("click", onTrigger);
  panel.addEventListener("click", onPanelClick);
  scrim.addEventListener("click", onScrimClick);
  explore.addEventListener("focusout", onFocusOut);
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("click", onDocumentClick);
  window.addEventListener("pageshow", onPageShow);

  return () => {
    hairline.disconnect();
    unsubscribe();
    trigger.removeEventListener("click", onTrigger);
    panel.removeEventListener("click", onPanelClick);
    scrim.removeEventListener("click", onScrimClick);
    explore.removeEventListener("focusout", onFocusOut);
    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener("click", onDocumentClick);
    window.removeEventListener("pageshow", onPageShow);
  };
});
