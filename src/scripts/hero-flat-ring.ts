// The ring as flat, translucent SVG strokes. It is the renderer wherever the glass ring
// can't run (no WebGL, or a lost GPU), and the hidden layout the glass ring reads. The
// bonds follow MarkFeedback exactly as the glass bonds do: hops, the working ring, the check.
import type { MarkFeedback } from "../lib/mark-feedback";

const BONDS = 3;
const PER_BOND = 60;

interface FlatRing {
  svg: SVGSVGElement;
  bonds: SVGPathElement[];
  paths: string[];
  done: string;
}

export interface FlatRings {
  draw(feedback: MarkFeedback): void;
  /** "shown" draws them; "gl" keeps them as invisible layout under the glass ring. */
  setState(state: "shown" | "gl"): void;
}

export function createFlatRings(svgs: SVGSVGElement[]): FlatRings {
  const rings: FlatRing[] = svgs.map((svg) => {
    const bonds = [...svg.querySelectorAll<SVGPathElement>(".ring-bonds path")];
    return { svg, bonds, paths: bonds.map((b) => b.getAttribute("d") ?? ""), done: "" };
  });
  let shown = false;

  return {
    draw(feedback) {
      if (!shown) return;
      const points = feedback.points();
      const paths: string[] = [];
      const brightness: number[] = [];
      for (let b = 0; b < BONDS; b++) {
        let d = "";
        let sum = 0;
        for (let i = 0; i < PER_BOND; i++) {
          const [x, y, k] = points[b * PER_BOND + i]!;
          d += `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
          sum += k;
        }
        paths.push(d);
        brightness.push(sum / PER_BOND);
      }
      const done = feedback.done.toFixed(3);
      for (const ring of rings) {
        ring.bonds.forEach((bond, b) => {
          if (paths[b] !== ring.paths[b]) {
            ring.paths[b] = paths[b]!;
            bond.setAttribute("d", paths[b]!);
          }
          // The working ring's bright head, as each arc's average: enough for flat strokes.
          bond.style.opacity = brightness[b]!.toFixed(2);
        });
        if (done !== ring.done) {
          ring.done = done;
          ring.svg.style.setProperty("--done", done);
        }
      }
    },
    setState(state) {
      shown = state === "shown";
      for (const ring of rings) ring.svg.dataset.state = state;
    },
  };
}
