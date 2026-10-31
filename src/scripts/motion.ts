// One answer to "may things move on their own?", shared by the hero and the process
// scene. Direct actions (a click, a chapter button) always work; only ambient motion and
// animated flourishes depend on this.
const query = window.matchMedia("(prefers-reduced-motion: reduce)");

type Listener = () => void;
const listeners = new Set<Listener>();
const notify = () => listeners.forEach((listener) => listener());

// The landing page has no pause control. Ignore its former saved pause setting;
// the visitor's system reduced-motion preference remains authoritative.
export const motion = {
  get reduced() {
    return query.matches;
  },
  /** True when something may move without being asked to. */
  get ambient() {
    return !query.matches;
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

query.addEventListener("change", notify);

// CSS reads this, so direct actions jump to their result when nothing may move.
const syncInstant = () => document.documentElement.toggleAttribute("data-instant", !motion.ambient);
motion.subscribe(syncInstant);
syncInstant();
