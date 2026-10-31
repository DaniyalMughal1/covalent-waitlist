export type TiltState = "off" | "requesting" | "on" | "denied";

interface PhoneTiltOptions {
  events: EventTarget;
  requestPermission?: () => Promise<string>;
  screenAngle: () => number;
  onTilt: (x: number, y: number) => void;
  onReset: () => void;
  onState: (state: TiltState) => void;
}

// Sensor input shares the hero's existing damped hover motion. The first reading is
// neutral, so holding a phone upright never snaps the mark to the edge of its range.
export function createPhoneTilt(options: PhoneTiltOptions) {
  let state: TiltState = "off";
  let active = false;
  let listening = false;
  let disposed = false;
  let request = 0;
  let origin: { beta: number; gamma: number; angle: number } | undefined;
  const clamp = (value: number) => Math.max(-1, Math.min(1, value / 28));
  const delta = (value: number, start: number) => ((value - start + 540) % 360) - 180;

  const receive = (raw: Event) => {
    const { beta, gamma } = raw as DeviceOrientationEvent;
    if (typeof beta !== "number" || typeof gamma !== "number" || !Number.isFinite(beta) || !Number.isFinite(gamma)) return;
    const angle = options.screenAngle();
    if (!origin || origin.angle !== angle) origin = { beta, gamma, angle };
    const pitch = delta(beta, origin.beta);
    const roll = delta(gamma, origin.gamma);
    const radians = angle * Math.PI / 180;
    options.onTilt(
      clamp(roll * Math.cos(radians) + pitch * Math.sin(radians)),
      clamp(pitch * Math.cos(radians) - roll * Math.sin(radians)),
    );
  };

  const sync = () => {
    const shouldListen = !disposed && active && state === "on";
    if (shouldListen === listening) return;
    listening = shouldListen;
    origin = undefined;
    if (listening) options.events.addEventListener("deviceorientation", receive);
    else {
      options.events.removeEventListener("deviceorientation", receive);
      options.onReset();
    }
  };
  const update = (next: TiltState) => {
    state = next;
    sync();
    options.onState(next);
  };

  return {
    async enable() {
      if (disposed || state === "on" || state === "requesting" || state === "denied") return;
      const current = ++request;
      update("requesting");
      try {
        // Called directly from a click on iOS: do not insert a timer or await first.
        const permission = options.requestPermission ? await options.requestPermission() : "granted";
        if (!disposed && current === request) update(permission === "granted" ? "on" : "denied");
      } catch {
        if (!disposed && current === request) update("denied");
      }
    },
    disable() {
      if (disposed) return;
      request++;
      update("off");
    },
    setActive(value: boolean) {
      active = value;
      sync();
    },
    destroy() {
      disposed = true;
      request++;
      sync();
    },
  };
}
