// The pause control. It only shows while something that is actually moving is on screen, and
// not at all under reduced motion. A surface says it can move by setting data-motion-live, so
// a hero left on its poster offers nothing to pause. It also gives way to the sections after
// the scene, whose own controls would otherwise slide under its fixed corner.
import { motion } from "./motion";
import { onPage } from "./page";

onPage(() => {
  const button = document.querySelector<HTMLButtonElement>("[data-motion-toggle]");
  const surfaces = [...document.querySelectorAll("[data-motion-surface]")];
  if (!button) return;

  const onScreen = new Set<Element>();
  const covered = new Set<Element>();
  const render = () => {
    const { paused, reduced } = motion;
    button.setAttribute("aria-label", paused ? "Resume motion" : "Pause motion");
    button.dataset.paused = String(paused);
    button.hidden = reduced;
    const live = [...onScreen].some((surface) => surface.hasAttribute("data-motion-live"));
    // Keyboard focus keeps it up: hiding the focused control would drop the visitor's place.
    button.dataset.visible = String((live && covered.size === 0) || button.matches(":focus-visible"));
  };

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) onScreen.add(entry.target);
      else onScreen.delete(entry.target);
    }
    render();
  });
  const flagged = new MutationObserver(render);
  surfaces.forEach((surface) => {
    observer.observe(surface);
    flagged.observe(surface, { attributeFilter: ["data-motion-live"] });
  });

  // Tracks the strip of the viewport the control sits in.
  const corner = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) covered.add(entry.target);
        else covered.delete(entry.target);
      }
      render();
    },
    { rootMargin: "-86% 0px 0px 0px" },
  );
  document.querySelectorAll("#questions, #access").forEach((section) => corner.observe(section));

  const toggle = () => motion.setPaused(!motion.paused);
  button.addEventListener("click", toggle);
  button.addEventListener("blur", render);
  const unsubscribe = motion.subscribe(render);
  render();

  return () => {
    observer.disconnect();
    corner.disconnect();
    flagged.disconnect();
    button.removeEventListener("click", toggle);
    button.removeEventListener("blur", render);
    unsubscribe();
  };
});
