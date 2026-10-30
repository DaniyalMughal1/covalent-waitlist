// Moving a window to a display with a different pixel ratio keeps its CSS size, so no resize
// or ResizeObserver reports it. A resolution query does, and it only ever matches one ratio,
// so each change re-arms it for the new one.
export function onDensityChange(listener: () => void) {
  let query: MediaQueryList;
  const arm = () => {
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener("change", changed);
  };
  const changed = () => {
    query.removeEventListener("change", changed);
    arm();
    listener();
  };
  arm();
  return () => query.removeEventListener("change", changed);
}
