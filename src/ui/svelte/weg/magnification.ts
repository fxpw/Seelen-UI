export interface DockCell {
  center: number;
  size: number;
  magnifiable: boolean;
  maxScale?: number;
  inset?: number;
}

/** Distance is measured against untransformed slots so the dock cannot chase its own animation. */
export function magnifyDock(cells: DockCell[], pointer: number, radius: number, strength = 1) {
  const scales = cells.map((cell) => {
    if (!cell.magnifiable || radius <= 0) return 1;
    const distance = Math.min(1, Math.max(0, Math.abs(cell.center - pointer) - (cell.inset ?? 0)) / radius);
    return 1 +
      ((cell.maxScale ?? 1.5) - 1) * Math.cos(distance * Math.PI / 2) ** 2 * Math.max(0, Math.min(1, strength));
  });
  const extra = cells.map((cell, index) => cell.size * (scales[index]! - 1));
  let accumulated = -extra.reduce((sum, value) => sum + value, 0) / 2;
  return cells.map((_cell, index) => {
    const offset = accumulated + extra[index]! / 2;
    accumulated += extra[index]!;
    return { scale: scales[index]!, offset };
  });
}

export function dockProximity(
  x: number,
  y: number,
  rect: { left: number; right: number; top: number; bottom: number },
  reach = 88,
): number {
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return Math.max(0, 1 - Math.hypot(dx, dy) / reach) ** 2;
}

export interface DockMagnifier {
  approach(x: number, y: number): void;
  destroy(): void;
}

/** Time-based smoothing has the same response at 60, 144 and other refresh rates. */
export function dockFrameBlend(elapsedMs: number): number {
  return 1 - Math.exp(-Math.max(0, elapsedMs) / 32);
}

/** Animate at display refresh rate; transparent desktop areas stay clickable. */
export function createDockMagnifier(node: HTMLElement): DockMagnifier {
  const media = matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
  const touched = new Set<HTMLElement>();
  let frame = 0;
  let pointer: { clientX: number; clientY: number } | null = null;
  let pressed = false;
  let previousTime = 0;
  const displayed = new Map<HTMLElement, { scale: number; offset: number }>();

  function reset() {
    cancelAnimationFrame(frame);
    frame = 0;
    pointer = null;
    previousTime = 0;
    displayed.clear();
    for (const element of touched) {
      for (const property of ["--dock-zoom", "--dock-shift-x", "--dock-shift-y", "z-index"]) {
        element.style.removeProperty(property);
      }
    }
    touched.clear();
  }

  function updateAvailability() {
    const container = node.querySelector<HTMLElement>(".weg-items-container");
    const items = node.querySelector<HTMLElement>(".weg-items");
    const horizontal = node.classList.contains("horizontal");
    const available = horizontal ? innerWidth : innerHeight;
    const content = horizontal ? items?.offsetWidth : items?.offsetHeight;
    const viewport = horizontal ? container?.clientWidth : container?.clientHeight;
    // Keep scrolling usable on crowded docks rather than clipping enlarged icons.
    const enabled = media.matches && content !== undefined && viewport !== undefined &&
      content <= viewport + 1 && content + 120 < available;
    node.dataset.magnification = String(enabled);
    if (!enabled) reset();
  }

  function update(time: number) {
    frame = 0;
    if (pressed) return;
    if (!pointer || node.dataset.magnification !== "true" || node.querySelector("[data-dragging=true]")) {
      reset();
      return;
    }
    const strength = dockProximity(pointer.clientX, pointer.clientY, node.getBoundingClientRect());
    if (strength <= 0 && !touched.size) {
      reset();
      return;
    }
    const horizontal = node.classList.contains("horizontal");
    const elements = Array.from(node.querySelectorAll<HTMLElement>(".weg-item-drag-container"));
    const appSize = Number.parseFloat(getComputedStyle(node).getPropertyValue("--config-item-size")) || 40;
    const cells = elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        center: horizontal ? rect.left + rect.width / 2 : rect.top + rect.height / 2,
        size: horizontal ? rect.width : rect.height,
        magnifiable: ["AppOrFile", "Media"].includes(element.dataset.itemKind ?? "") &&
          !element.querySelector(".weg-split-items"),
        maxScale: element.dataset.itemKind === "Media" ? 1.2 : 1.5,
        inset: element.dataset.itemKind === "Media"
          ? Math.max(0, (horizontal ? rect.width : rect.height) - appSize) / 2
          : 0,
      };
    });
    const position = horizontal ? pointer.clientX : pointer.clientY;
    const active = cells.find((cell) => cell.magnifiable && Math.abs(cell.center - position) <= cell.size / 2);
    const radius = appSize * 2.5 + Math.max(0, (active?.size ?? appSize) - appSize) / 2;
    const values = magnifyDock(cells, position, radius, strength);
    const blend = dockFrameBlend(previousTime ? time - previousTime : 1000 / 144);
    previousTime = time;
    let unsettled = false;
    elements.forEach((element, index) => {
      const target = values[index]!;
      const current = displayed.get(element) ?? { scale: 1, offset: 0 };
      const moving = Math.abs(target.scale - current.scale) > 0.0001 || Math.abs(target.offset - current.offset) > 0.01;
      const scale = moving ? current.scale + (target.scale - current.scale) * blend : target.scale;
      const offset = moving ? current.offset + (target.offset - current.offset) * blend : target.offset;
      unsettled ||= moving;
      displayed.set(element, { scale, offset });
      element.style.setProperty("--dock-zoom", scale.toFixed(5));
      element.style.setProperty("--dock-shift-x", `${horizontal ? offset.toFixed(3) : 0}px`);
      element.style.setProperty("--dock-shift-y", `${horizontal ? 0 : offset.toFixed(3)}px`);
      const zIndex = String(Math.round(scale * 100));
      if (element.style.zIndex !== zIndex) element.style.zIndex = zIndex;
      touched.add(element);
    });
    if (unsettled) frame = requestAnimationFrame(update);
    else {
      previousTime = 0;
      if (strength <= 0) reset();
    }
  }

  function move(event: PointerEvent) {
    if (event.pointerType !== "mouse") {
      reset();
      return;
    }
    // Freeze during a click so its release still hits the same enlarged icon.
    if (event.buttons) return;
    pressed = false;
    approach(event.clientX, event.clientY);
  }

  function approach(x: number, y: number) {
    if (pressed) return;
    pointer = { clientX: x, clientY: y };
    if (!frame) frame = requestAnimationFrame(update);
  }

  function press() {
    pressed = true;
    cancelAnimationFrame(frame);
    frame = 0;
    previousTime = 0;
  }
  function release() {
    pressed = false;
  }
  function blur() {
    pressed = false;
    reset();
  }

  const resize = new ResizeObserver(updateAvailability);
  const dragging = new MutationObserver(() => {
    if (node.querySelector("[data-dragging=true]")) reset();
  });
  dragging.observe(node, { subtree: true, attributes: true, attributeFilter: ["data-dragging"] });
  resize.observe(node);
  media.addEventListener("change", updateAvailability);
  node.addEventListener("pointermove", move);
  node.addEventListener("pointerdown", press);
  window.addEventListener("pointerup", release);
  window.addEventListener("blur", blur);
  updateAvailability();
  return {
    approach,
    destroy() {
      reset();
      resize.disconnect();
      dragging.disconnect();
      media.removeEventListener("change", updateAvailability);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerdown", press);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("blur", blur);
      delete node.dataset.magnification;
    },
  };
}
