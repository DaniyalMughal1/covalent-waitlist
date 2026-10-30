// Delta-time motion. Both helpers are exact solutions rather than per-frame nudges, so the
// same gesture lands in the same place at 30, 60 or 120 frames a second.

export interface Spring {
  x: number;
  v: number;
}

/** One step of a damped spring toward `target`. `zeta` below 1 overshoots; 1 does not. */
export function stepSpring(spring: Spring, target: number, omega: number, zeta: number, dt: number) {
  const x0 = spring.x - target;
  const v0 = spring.v;

  if (zeta < 1) {
    const decay = zeta * omega;
    const ringing = omega * Math.sqrt(1 - zeta * zeta);
    const e = Math.exp(-decay * dt);
    const c = Math.cos(ringing * dt);
    const s = Math.sin(ringing * dt);
    const b = (v0 + decay * x0) / ringing;
    spring.x = target + e * (x0 * c + b * s);
    spring.v = e * (v0 * c - (x0 * ringing + decay * b) * s);
    return;
  }

  const e = Math.exp(-omega * dt);
  const b = v0 + omega * x0;
  spring.x = target + e * (x0 + b * dt);
  spring.v = e * (v0 - omega * b * dt);
}

/** True once the spring is close enough to `target` that another frame would not show. */
export function atRest(spring: Spring, target: number, epsilon = 1e-4) {
  return Math.abs(spring.x - target) < epsilon && Math.abs(spring.v) < epsilon * 4;
}

/** Eases `current` toward `target`; `rate` is the reciprocal of the time constant in seconds. */
export function damp(current: number, target: number, rate: number, dt: number) {
  return target + (current - target) * Math.exp(-rate * dt);
}
