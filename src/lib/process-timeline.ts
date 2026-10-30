// The process scene's single owner: a pure function from scroll progress to scene state.
// Nothing here knows about time, direction or the DOM, so scrolling back up, reloading
// halfway down and jumping with a chapter button all land on exactly the same picture.
import { AGENT_THICKNESS, GROUND_TOP, POSE, TOKEN_OFFSET, TOKEN_THICKNESS, handoffPoint } from "./process-scene";

/** Captions swap here. */
export const BOUNDARIES = [0.25, 0.53, 0.79] as const;

/** Each beat's held position, where chapter buttons land. */
export const HOLDS = [0.17, 0.46, 0.75, 0.95] as const;

export type Stage = 0 | 1 | 2 | 3;

export interface Placed {
  x: number;
  y: number;
  z: number;
}

export interface Shadow {
  opacity: number;
  scale: number;
  /** The surface it falls on. */
  z: number;
}

export interface SceneState {
  stage: Stage;
  /** World height added to the shared plane while it settles. */
  sharedLift: number;
  ui: Placed;
  api: Placed;
  /** Contact shadow: tight and dark at rest, wide and faint when lifted. */
  shadow: { ui: Shadow; api: Shadow };
  /** Ownership edges and footprints, 0 before any claim. */
  edge: number;
  footprint: number;
  /** Filename tabs: how far out of the plate, and whether they show. */
  tab: {
    out: number;
    opacity: number;
    /** The file name, which waits until it has cleared the plate it slides out from under. */
    label: number;
    /** 1 once the file is claimed. Where a plate has room for one label, the file's. */
    claimed: number;
  };
  /** Agent names and their poles. */
  agentLabel: number;
  /** The attached copy of the brief, shown where the flat print is too small to read. */
  briefLabel: number;
  tethers: number;
  reads: { draw: number; opacity: number };
  handoff: { draw: number; opacity: number };
  token: Placed & { opacity: number; label: number; shadow: number };
  bracket: { opacity: number; drop: number };
  /** How much of the ambient hover applies; only lifted, unconnected plates hover. */
  hover: number;
}

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

// Both start and finish with zero velocity, so joined segments never show a kink.
const ease = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const glide = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export function stageAt(p: number): Stage {
  if (p < BOUNDARIES[0]) return 0;
  if (p < BOUNDARIES[1]) return 1;
  if (p < BOUNDARIES[2]) return 2;
  return 3;
}

const REST_SPREAD = 16;
const REST_HOVER = 40;
// Height of the plates' underside while they slide along the shared plane on the way home.
const RETURN_Z = 8;

interface Return {
  /** Back down to the shared plane, over the plate's own footprint. */
  lower: number;
  /** Along the plane and out past its front edge. */
  forward: number;
  /** In front of the plane, toward the other plate. */
  sweep: number;
  /** Off the plane's level, down to the base. */
  drop: number;
}

function agent(side: -1 | 1, settle: number, claim: number, back: Return): Placed {
  const { rest, claim: claimed, dock } = POSE;
  const home = side < 0 ? dock.ui : dock.api;
  const restX = mix(rest.x + REST_SPREAD, rest.x, settle);
  const restZ = mix(rest.z + REST_HOVER, rest.z, settle);
  const raised = mix(restZ, claimed.z, claim);
  return {
    x: mix(side * mix(restX, claimed.x, claim), home.x, back.sweep),
    y: mix(mix(rest.y, claimed.y, claim), home.y, back.forward),
    z: mix(mix(raised, RETURN_Z, back.lower), home.z, back.drop),
  };
}

export function sceneAt(progress: number): SceneState {
  const p = clamp(progress);

  const settle = glide(0, 0.1, p);
  const claim = glide(0.25, 0.39, p);
  // The way home keeps the printed brief clear at every p: down onto the footprints, out
  // along the plane, across in front of it, and only then down to the base. The stages
  // overlap so the plates take one long curve at about the pace of the claim.
  const back: Return = {
    lower: glide(0.79, 0.84, p),
    forward: glide(0.8, 0.89, p),
    sweep: glide(0.84, 0.915, p),
    drop: glide(0.873, 0.93, p),
  };

  const ui = agent(-1, settle, claim, back);
  const api = agent(1, settle, claim, back);

  // The path leads, the token follows on the same parameter, so it reverses exactly.
  const travel = ease(0.56, 0.69, p);
  const draw = clamp((p - 0.535) / (0.665 - 0.535));
  const onPath = handoffPoint(travel);

  // Once docked the token belongs to the UI plate and rides down with it. Its `z` is its
  // top face, so on the way over its underside runs along the line.
  const docked: Placed = { x: ui.x + TOKEN_OFFSET.ui, y: ui.y, z: ui.z + AGENT_THICKNESS + TOKEN_THICKNESS };
  const flying: Placed = { x: onPath[0], y: onPath[1], z: onPath[2] + TOKEN_THICKNESS };

  // Shadows fall on the plane, then cross its edge to the base. They dip out while
  // crossing so one never lies across the plane's wall.
  const lifted = claim * (1 - back.lower);
  const crossing = ease(0.866, 0.884, p);
  const shadowOf = () => ({
    opacity: mix(0.95, 0.4, lifted) * (1 - ease(0.848, 0.866, p) * (1 - ease(0.884, 0.925, p))),
    scale: mix(1, 1.16, lifted),
    z: mix(0, GROUND_TOP, crossing),
  });

  return {
    stage: stageAt(p),
    sharedLift: mix(30, 0, settle),
    ui,
    api,
    shadow: { ui: shadowOf(), api: shadowOf() },
    edge: ease(0.28, 0.37, p) * mix(1, 0.62, ease(0.85, 0.93, p)),
    footprint: ease(0.3, 0.38, p) * mix(1, 0.7, ease(0.85, 0.93, p)),
    tab: {
      out: glide(0.335, 0.41, p),
      opacity: ease(0.345, 0.375, p) * (1 - ease(0.79, 0.815, p)),
      label: ease(0.365, 0.39, p) * (1 - ease(0.79, 0.815, p)),
      claimed: ease(0.33, 0.345, p),
    },
    agentLabel: 1 - ease(0.79, 0.815, p),
    briefLabel: 1 - ease(0.24, 0.27, p),
    tethers: ease(0.37, 0.41, p) * (1 - ease(0.785, 0.8, p)),
    // Nothing of the lines exists until the plane has come to rest under them, so the
    // first frame shows the brief with its words untouched.
    reads: { draw: ease(0.1, 0.155, p), opacity: ease(0.095, 0.115, p) * (1 - ease(0.245, 0.275, p)) },
    handoff: { draw, opacity: ease(0.53, 0.545, p) * (1 - ease(0.785, 0.81, p)) },
    token: {
      ...(travel >= 1 ? docked : flying),
      opacity: ease(0.535, 0.555, p),
      // Named before it moves, and the leader goes with the word.
      label: ease(0.54, 0.56, p) * (1 - ease(0.785, 0.81, p)),
      shadow: 0.5 * ease(0.57, 0.595, p) * (1 - ease(0.665, 0.69, p)),
    },
    // Printed on the base, so it appears once the plates are down.
    bracket: { opacity: ease(0.926, 0.94, p), drop: mix(16, 0, glide(0.915, 0.94, p)) },
    hover: ease(0.385, 0.42, p) * (1 - ease(0.5, 0.53, p)),
  };
}
