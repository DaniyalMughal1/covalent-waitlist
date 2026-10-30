// Page-scoped setup. Runs now and again after an Astro client-side swap, and always
// releases what it took (listeners, observers, the renderer) before the page goes away.
// A page kept in the back/forward cache is left intact; its own pageshow handling resumes.
type Cleanup = () => void;

export function onPage(setup: () => Cleanup | void) {
  let cleanup: Cleanup | void;
  const stop = () => {
    cleanup?.();
    cleanup = undefined;
  };
  const start = () => {
    stop();
    cleanup = setup();
  };

  start();
  document.addEventListener("astro:before-swap", stop);
  document.addEventListener("astro:after-swap", start);
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) stop();
  });
}
