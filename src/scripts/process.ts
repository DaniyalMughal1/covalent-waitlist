import { onPage } from "./page";
import { motion } from "./motion";
import type { BondScene } from "./coordination-scene";

const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const smooth = (v: number) => {
  v = clamp(v);
  return v * v * (3 - 2 * v);
};
const captions = [
  "Invite links expire after 24 hours.",
  "One file. Two agents. Separate regions.",
  "The endpoint is ready. Connect the form.",
  "Your team stays in the picture.",
];

onPage(() => {
  const section = document.querySelector<HTMLElement>("[data-coordination]");
  if (!section) return;
  const pin = section.querySelector<HTMLElement>("[data-coordination-pin]")!;
  const visual = section.querySelector<HTMLElement>(
    "[data-coordination-visual]",
  )!;
  const molecule = section.querySelector<HTMLElement>("[data-molecule]")!;
  const canvas = section.querySelector<HTMLCanvasElement>(
    "[data-coordination-canvas]",
  )!;
  const chapters = [...section.querySelectorAll<HTMLElement>("[data-chapter]")];
  const buttons = [
    ...section.querySelectorAll<HTMLButtonElement>("[data-chapter-button]"),
  ];
  const claims = [...section.querySelectorAll<HTMLElement>("[data-claim]")];
  const labels = [
    ...section.querySelectorAll<HTMLElement>("[data-agent-label]"),
  ];
  const statuses = [
    ...section.querySelectorAll<HTMLElement>("[data-agent-status]"),
  ];
  const context = section.querySelector<HTMLElement>("[data-context-label]")!;
  const contextText = section.querySelector<HTMLElement>(
    "[data-context-text]",
  )!;
  const transfer = section.querySelector<HTMLElement>("[data-transfer]")!;
  const workspace = section.querySelector<HTMLElement>(
    "[data-workspace-reveal]",
  )!;
  const windowEl = section.querySelector<HTMLElement>(
    "[data-workspace-window]",
  )!;
  const count = section.querySelector<HTMLElement>("[data-chapter-count]")!;
  const caption = section.querySelector<HTMLElement>(
    "[data-coordination-caption]",
  )!;
  const messageGroups = [
    ".workspace-prompt",
    ".workspace-response",
    ".workspace-handoff",
  ].map((selector) => [...section.querySelectorAll<HTMLElement>(selector)]);
  const windowLayers = [
    ".workspace-sidebar",
    ".workspace-conversation",
    ".workspace-context",
  ].map((selector) => section.querySelector<HTMLElement>(selector)!);
  const compactQuery = matchMedia("(max-width:800px), (max-height:800px)");
  const controller = new AbortController();
  const { signal } = controller;
  let scene: BondScene | undefined,
    sceneRequested = false,
    destroyed = false,
    active = false;
  let frame = 0,
    last = 0,
    clock = 0,
    progress = 0,
    velocity = 0,
    target = 0,
    chapter = -1,
    compact = true;
  let top = 0,
    range = 1;
  const pointer = { x: 0, y: 0 },
    pointerTarget = { x: 0, y: 0 };
  section.dataset.copyReady = "true";
  chapters.forEach((el, i) => {
    el.style.opacity = i === 0 ? "1" : "0";
    el.hidden = false;
  });

  function showChapter(index: number) {
    if (index === chapter) return;
    chapter = index;
    section!.dataset.chapter = String(index);
    chapters.forEach((el, i) => {
      el.setAttribute("aria-hidden", String(i !== index));
    });
    buttons.forEach((el, i) => {
      if (i === index) el.setAttribute("aria-current", "step");
      else el.removeAttribute("aria-current");
    });
    count.textContent = `0${index + 1} / 04`;
    caption.textContent = captions[index];
    statuses[0].textContent =
      index === 0
        ? "UI & invitations"
        : index === 1
          ? "createInvite()"
          : "Handoff received";
    statuses[1].textContent =
      index === 0
        ? "API & permissions"
        : index === 1
          ? "acceptInvite()"
          : "Endpoint ready";
    contextText.textContent =
      index === 0
        ? "One shared task"
        : index === 1
          ? "src/invites.ts"
          : "Context carried forward";
  }
  function readScroll() {
    if (!compact) target = clamp((window.scrollY - top) / range) * 3;
  }
  function resize() {
    const nextCompact = compactQuery.matches || motion.reduced;
    if (nextCompact && !compact) target = Math.round(progress);
    compact = nextCompact;
    section!.dataset.scroll = String(!compact);
    section!.dataset.mode = compact ? "compact" : "scroll";
    top = section!.getBoundingClientRect().top + window.scrollY;
    range = Math.max(1, section!.offsetHeight - pin.offsetHeight);
    scene?.resize();
    if (active) void loadScene();
    readScroll();
    schedule();
  }
  function schedule() {
    if (!frame && !destroyed) frame = requestAnimationFrame(render);
  }
  function render(now: number) {
    frame = 0;
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    const moving = motion.ambient;
    // A critically damped response carries momentum through wheel/trackpad events
    // without bouncing or taking control of the page's native scroll position.
    if (moving) {
      const frequency = 12;
      const offset = progress - target;
      const impulse = velocity + frequency * offset;
      const decay = Math.exp(-frequency * dt);
      progress = clamp(target + (offset + impulse * dt) * decay, 0, 3);
      velocity = (velocity - frequency * impulse * dt) * decay;
      if (Math.abs(target - progress) < 0.0005 && Math.abs(velocity) < 0.005) {
        progress = target;
        velocity = 0;
      }
    } else {
      progress = target;
      velocity = 0;
    }
    const smoothFactor = moving ? 1 - Math.exp(-dt * 5.5) : 1;
    pointer.x += (pointerTarget.x - pointer.x) * smoothFactor;
    pointer.y += (pointerTarget.y - pointer.y) * smoothFactor;
    if (active && moving && !document.hidden) clock += dt;
    const index = clamp(Math.floor(progress + 0.5), 0, 3);
    showChapter(index);
    chapters.forEach((el, i) => {
      const enter = i === 0 ? 1 : smooth((progress - i + 0.65) / 0.3);
      const leave = i === 3 ? 0 : smooth((progress - i - 0.35) / 0.3);
      const opacity = moving ? enter * (1 - leave) : Number(i === index);
      el.style.opacity = String(opacity);
      el.style.visibility = opacity > 0 ? "visible" : "hidden";
      el.style.transform = moving
        ? `translateY(${(1 - enter) * 18 - leave * 14}px)`
        : "none";
    });
    const textPresence = moving
      ? 1 - smooth((Math.abs(progress - index) - 0.35) / 0.15)
      : 1;
    caption.style.opacity = String(textPresence);
    contextText.style.opacity = String(textPresence);
    statuses.forEach((el) => (el.style.opacity = String(textPresence)));
    buttons.forEach((b, i) =>
      b.style.setProperty("--fill", String(clamp(progress - i + 1))),
    );
    const opening = smooth((progress - 2.18) / 0.78);
    const momentum = clamp(velocity * 0.45, -1, 1);
    const drift = motion.reduced || compact ? 0 : Math.sin(clock * 0.55) * 3;
    const ambientVisible = opening < 1 || !compact;
    if (ambientVisible && !motion.reduced) {
      if (!visual.hasAttribute("data-motion-live"))
        visual.setAttribute("data-motion-live", "");
    } else if (visual.hasAttribute("data-motion-live"))
      visual.removeAttribute("data-motion-live");
    claims.forEach((el, i) => {
      const claimVisibility =
        smooth((progress - 0.5 - i * 0.08) / 0.36) *
        (1 - smooth((progress - 1.58) / 0.36));
      el.style.opacity = String(claimVisibility);
      el.style.translate = `0 ${(1 - claimVisibility) * 12}px`;
    });
    transfer.style.opacity = String(
      smooth((progress - 1.55) / 0.3) * (1 - opening),
    );
    molecule.style.opacity = String(1 - opening);
    molecule.style.transform = `translate3d(${-opening * 40}px,${-opening * 30}px,0) scale(${1 - opening * 0.18})`;
    workspace.hidden = opening === 0;
    workspace.style.opacity = String(opening);
    workspace.style.pointerEvents = opening > 0.95 ? "auto" : "none";
    workspace.inert = opening < 0.95;
    if (compact || motion.reduced) {
      windowEl.style.transform = "none";
      workspace.style.transform = `translateY(${(1 - opening) * 15}px)`;
    } else {
      const floatTurn = Math.sin(clock * 0.37) * 0.45;
      windowEl.style.transform = `rotateY(${-29 + opening * 19.1 + pointer.x * 2 + floatTurn + momentum * 1.7}deg) rotateX(${19 - opening * 14.8 - pointer.y * 1.3 + Math.sin(clock * 0.43) * 0.3}deg) rotateZ(${-4 * (1 - opening) + momentum * 0.4}deg)`;
      workspace.style.transform = `translate3d(${(1 - opening) * 100}px,${(1 - opening) * 65 + drift}px,0) scale(${0.78 + opening * 0.22})`;
    }
    windowLayers.forEach((el, i) => {
      const arrival =
        compact || !moving
          ? opening
          : smooth((progress - 2.22 - i * 0.08) / 0.52);
      el.style.opacity = String(arrival);
      el.style.transform =
        compact || !moving
          ? "none"
          : `translate3d(${(1 - arrival) * (i === 0 ? -20 : 20)}px,${(1 - arrival) * 16}px,0)`;
    });
    messageGroups.forEach((elements, i) => {
      const entrance = compact
        ? opening
        : smooth((progress - (2.38 + i * 0.15)) / 0.27);
      elements.forEach((el) => {
        el.style.opacity = String(entrance);
        el.style.transform = `translateY(${(1 - entrance) * 10}px)`;
      });
    });
    if (scene && active && opening < 1) {
      const projected = scene.draw(progress, clock, pointer, momentum);
      molecule.dataset.rendered = "true";
      [projected.left, projected.right].forEach(([x, y], i) => {
        labels[i].style.left = `${x}%`;
        labels[i].style.top = `${y - 15}%`;
        claims[i].style.left = `${x}%`;
        claims[i].style.top = `${y + 17}%`;
      });
      context.style.left = `${projected.center[0]}%`;
      context.style.top = `${projected.center[1]}%`;
    } else if (!scene) {
      const fallback = section!.querySelector<SVGElement>(
        "[data-molecule-fallback]",
      )!;
      fallback.style.transform = motion.reduced
        ? "none"
        : `rotate(${Math.sin(clock * 0.4) * 2.5 + Math.sin(progress * 1.1) * 4}deg) scale(${1 + Math.sin(clock * 0.5) * 0.008})`;
      fallback.style.translate = motion.reduced
        ? "none"
        : `0 ${Math.sin(clock * 0.6) * 4}px`;
    }
    const settling =
      progress !== target ||
      Math.abs(pointer.x - pointerTarget.x) > 0.001 ||
      Math.abs(pointer.y - pointerTarget.y) > 0.001;
    if (active && !document.hidden && ((moving && ambientVisible) || settling))
      schedule();
  }
  async function loadScene() {
    if (sceneRequested || compactQuery.matches || motion.reduced) return;
    sceneRequested = true;
    try {
      const { createBondScene } = await import("./coordination-scene");
      if (destroyed) return;
      scene = createBondScene(canvas, visual);
      schedule();
    } catch (error) {
      // The SVG remains usable when the browser cannot create another WebGL context.
      console.info(
        "Covalent demo is using its SVG scene.",
        error instanceof Error ? error.message : error,
      );
    }
  }
  canvas.addEventListener(
    "webglcontextlost",
    (event) => {
      event.preventDefault();
      scene?.destroy();
      scene = undefined;
      delete molecule.dataset.rendered;
      schedule();
    },
    { signal },
  );
  const observer = new IntersectionObserver(
    (entries) => {
      active = entries.some((e) => e.isIntersecting);
      last = 0;
      if (active) {
        void loadScene();
        readScroll();
        schedule();
      } else {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    },
    { rootMargin: "100px" },
  );
  observer.observe(pin);
  const sizeObserver = new ResizeObserver(() => resize());
  sizeObserver.observe(visual);
  window.addEventListener(
    "scroll",
    () => {
      readScroll();
      if (active) schedule();
    },
    { passive: true, signal },
  );
  window.addEventListener("resize", resize, { passive: true, signal });
  document.addEventListener(
    "visibilitychange",
    () => {
      last = 0;
      if (!document.hidden) schedule();
    },
    { signal },
  );
  visual.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType !== "mouse" || !motion.ambient) return;
      const box = visual.getBoundingClientRect();
      pointerTarget.x = clamp(
        ((e.clientX - box.left) / box.width) * 2 - 1,
        -1,
        1,
      );
      pointerTarget.y = clamp(
        ((e.clientY - box.top) / box.height) * 2 - 1,
        -1,
        1,
      );
      schedule();
    },
    { passive: true, signal },
  );
  visual.addEventListener(
    "pointerleave",
    () => {
      pointerTarget.x = pointerTarget.y = 0;
      schedule();
    },
    { signal },
  );
  buttons.forEach((button, i) =>
    button.addEventListener(
      "click",
      () => {
        if (compact) {
          target = i;
          schedule();
        } else
          window.scrollTo({
            top: top + (range * i) / 3,
            behavior: motion.ambient ? "smooth" : "instant",
          });
      },
      { signal },
    ),
  );

  const agentButtons = [
    ...section.querySelectorAll<HTMLButtonElement>("[data-demo-agent]"),
  ];
  agentButtons.forEach((button) =>
    button.addEventListener(
      "click",
      () => {
        const name = button.dataset.demoAgent;
        agentButtons.forEach((b) => {
          const selected = b === button;
          b.classList.toggle("is-selected", selected);
          b.setAttribute("aria-pressed", String(selected));
        });
        section!
          .querySelectorAll<HTMLElement>("[data-demo-thread]")
          .forEach((el) => {
            el.hidden = el.dataset.demoThread !== name;
          });
        section!.querySelector<HTMLElement>(
          "[data-demo-agent-title]",
        )!.textContent = name === "maya" ? "Maya’s agent" : "Theo’s agent";
      },
      { signal },
    ),
  );
  const recordTabs = [
    ...section.querySelectorAll<HTMLButtonElement>("[data-record-tab]"),
  ];
  function selectRecord(button: HTMLButtonElement) {
    recordTabs.forEach((b) => {
      b.setAttribute("aria-selected", String(b === button));
      b.tabIndex = b === button ? 0 : -1;
    });
    section!
      .querySelectorAll<HTMLElement>("[data-record-panel]")
      .forEach((p) => {
        p.hidden = p.dataset.recordPanel !== button.dataset.recordTab;
      });
  }
  recordTabs.forEach((button, i) => {
    button.addEventListener("click", () => selectRecord(button), { signal });
    button.addEventListener(
      "keydown",
      (e) => {
        let next = i;
        if (e.key === "ArrowRight") next = (i + 1) % recordTabs.length;
        else if (e.key === "ArrowLeft")
          next = (i + recordTabs.length - 1) % recordTabs.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = recordTabs.length - 1;
        else return;
        e.preventDefault();
        selectRecord(recordTabs[next]);
        recordTabs[next].focus();
      },
      { signal },
    );
  });
  const unsubscribe = motion.subscribe(() => {
    resize();
    last = 0;
    schedule();
  });
  compactQuery.addEventListener("change", resize, { signal });
  resize();
  showChapter(0);
  schedule();
  return () => {
    destroyed = true;
    controller.abort();
    unsubscribe();
    observer.disconnect();
    sizeObserver.disconnect();
    cancelAnimationFrame(frame);
    scene?.destroy();
  };
});
