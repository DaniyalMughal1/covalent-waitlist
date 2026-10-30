// One answer to "may things move on their own?", shared by the hero and the process
// scene. Direct actions (a click, a chapter button) always work; only ambient motion and
// animated flourishes depend on this.
const KEY = "covalent:motion-paused";
const query = window.matchMedia("(prefers-reduced-motion: reduce)");

type Listener = () => void;
const listeners = new Set<Listener>();
const notify = () => listeners.forEach((listener) => listener());

// A convenience only: the page behaves correctly when storage is unavailable.
function readPaused() {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let paused = readPaused();

export const motion = {
  get reduced() {
    return query.matches;
  },
  get paused() {
    return paused;
  },
  /** True when something may move without being asked to. */
  get ambient() {
    return !paused && !query.matches;
  },
  setPaused(value: boolean) {
    if (value === paused) return;
    paused = value;
    try {
      window.localStorage.setItem(KEY, value ? "1" : "0");
    } catch {
      // Storage is blocked; the choice still holds for this page view.
    }
    notify();
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

query.addEventListener("change", notify);
