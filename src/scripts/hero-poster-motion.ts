import { motion } from "./motion";
import type { HeroScene } from "./hero-scene";
import type { MarkFeedback, BondPoint } from "../lib/mark-feedback";

// Preserve the photographed outer ring. A small SVG animates the inner bonds if the
// browser cannot run WebGL; both renderers read the same terminal-inspired state.
export function createPosterMotion(stage: HTMLElement, poster: HTMLElement, feedback: MarkFeedback): HeroScene {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 1000 1000");
  svg.setAttribute("aria-hidden", "true");
  Object.assign(svg.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none", opacity: "0" });
  const rad = Math.PI / 180;
  const project = (x: number, y: number) => {
    y = -y;
    const pitch = -9 * rad, yaw = -18 * rad;
    const py = y * Math.cos(pitch), pz = y * Math.sin(pitch);
    const px = x * Math.cos(yaw) + pz * Math.sin(yaw);
    const z = -x * Math.sin(yaw) + pz * Math.cos(yaw);
    const scale = 500 / Math.tan(11 * rad) / (652 - z);
    return [500 + px * scale, 500 - py * scale];
  };
  const hole = Array.from({ length: 6 }, (_, i) => project(81 * Math.cos(i * Math.PI / 3), 81 * Math.sin(i * Math.PI / 3)))
    .map(([x, y]) => `${x! / 1000} ${y! / 1000}`).join("L");
  svg.innerHTML = `<defs>
    <clipPath id="hero-bond-cutout" clipPathUnits="objectBoundingBox"><path clip-rule="evenodd" d="M0 0H1V1H0ZM${hole}Z"/></clipPath>
    <linearGradient id="hero-bond-silver" x1="0" y1="0" x2=".25" y2="1">
      <stop stop-color="#f8f9fa"/><stop offset=".2" stop-color="#b8bdc2"/><stop offset=".45" stop-color="#747b83"/>
      <stop offset=".66" stop-color="#d8dce0"/><stop offset=".84" stop-color="#f7f8f9"/><stop offset="1" stop-color="#4b515a"/>
    </linearGradient>
  </defs><g fill="none" stroke-linecap="round" stroke-linejoin="round"></g>`;
  const group = svg.querySelector("g")!;
  const paths = Array.from({ length: 4 }, () => {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("stroke", "url(#hero-bond-silver)");
    path.setAttribute("stroke-width", "51");
    group.append(path);
    return path;
  });
  stage.append(svg);
  const pathData = (points: readonly BondPoint[]) => points.map(([x, y], i) => `${i ? "L" : "M"}${project(x!, y!).map(v => v.toFixed(2)).join(" ")}`).join("");
  const renderBonds = () => {
    svg.style.opacity = "1";
    poster.style.clipPath = "url(#hero-bond-cutout)";
    const points = feedback.points();
    const joined = feedback.done === 1;
    for (let i = 0; i < 3; i++) {
      paths[i]!.setAttribute("d", pathData(points.slice(i * 60, i * 60 + 60)));
      paths[i]!.style.opacity = joined ? "0" : "1";
    }
    paths[3]!.setAttribute("d", joined ? pathData(points) : "");
    paths[3]!.style.opacity = joined ? "1" : "0";
  };

  let active = false, destroyed = false, frame = 0, last = 0, clock = 0;
  let x = 0, y = 0, targetX = 0, targetY = 0, dragX = 0, dragY = 0;
  let dragging = false, pulse = 0;
  const draw = () => {
    const drift = motion.ambient ? Math.sin(clock * .75) * 3 : 0;
    const yaw = x + (motion.ambient ? Math.sin(clock * .43) * 1.5 : 0);
    const pitch = y + (motion.ambient ? Math.sin(clock * .57) : 0);
    stage.style.transform = `perspective(1000px) translateY(${drift - pulse * 3}px) rotateX(${pitch}deg) rotateY(${yaw}deg)`;
    renderBonds();
  };
  const schedule = () => { if (active && !destroyed && !frame) frame = requestAnimationFrame(tick); };
  const tick = (now: number) => {
    frame = 0;
    const dt = last ? Math.min((now - last) / 1000, .05) : 1 / 60;
    last = now;
    if (motion.ambient) clock += dt;
    feedback.update(dt, motion.ambient);
    const gain = motion.ambient ? 1 - Math.exp(-dt * 9) : 1;
    x += (targetX - x) * gain; y += (targetY - y) * gain;
    pulse *= Math.exp(-dt * 4);
    draw();
    if (motion.ambient || Math.abs(x - targetX) + Math.abs(y - targetY) + pulse > .005) schedule();
  };
  const reset = () => { targetX = targetY = 0; dragging = false; schedule(); };
  return {
    reveal() { poster.style.visibility = ""; poster.style.opacity = ""; svg.style.visibility = ""; draw(); schedule(); },
    setActive(value) {
      active = value; last = 0;
      if (value) { stage.style.willChange = "transform"; svg.style.visibility = ""; schedule(); }
      else { cancelAnimationFrame(frame); frame = 0; stage.style.willChange = ""; svg.style.visibility = "hidden"; }
    },
    hover(nx, ny) { if (motion.ambient && !dragging) { targetX = nx * 10; targetY = -ny * 8; schedule(); } },
    leave() { if (!dragging) reset(); },
    dragStart() { dragging = true; dragX = x; dragY = y; },
    drag(dx, dy) { targetX = Math.max(-24, Math.min(24, dragX + dx * .14)); targetY = Math.max(-18, Math.min(18, dragY - dy * .12)); schedule(); },
    dragEnd: reset,
    turn(direction = 1) { feedback.hop(direction); if (!motion.ambient) feedback.update(0, false); draw(); schedule(); },
    setWorking(value) { feedback.setWorking(value); if (!motion.ambient) feedback.update(0, false); draw(); schedule(); },
    settle() { feedback.finish(); pulse = motion.ambient ? 1 : 0; if (!motion.ambient) feedback.update(0, false); draw(); schedule(); },
    scrolled() {},
    motionChanged() { if (!motion.ambient) { x = y = targetX = targetY = pulse = 0; feedback.update(0, false); } draw(); schedule(); },
    destroy() { destroyed = true; cancelAnimationFrame(frame); svg.remove(); stage.style.transform = ""; stage.style.willChange = ""; poster.style.clipPath = ""; },
  };
}
