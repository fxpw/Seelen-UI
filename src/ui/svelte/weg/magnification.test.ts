import assert from "node:assert/strict";
import test from "node:test";
import { createDockMagnifier, dockFrameBlend, dockProximity, magnifyDock } from "./magnification.ts";

test("animation continues between input samples, rests when settled, freezes clicks and cleans up", () => {
  const globals = [
    "window",
    "innerWidth",
    "innerHeight",
    "matchMedia",
    "getComputedStyle",
    "ResizeObserver",
    "MutationObserver",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ] as const;
  const saved = globals.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  const pending = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  let time = 0;
  const properties = new Map<string, string>();
  const item = {
    dataset: { itemKind: "AppOrFile" },
    style: {
      zIndex: "",
      setProperty: (key: string, value: string) => properties.set(key, value),
      removeProperty: (key: string) => properties.delete(key),
    },
    getBoundingClientRect: () => ({ left: 100, top: 100, width: 40, height: 40 }),
    querySelector: () => null,
  };
  const node = Object.assign(new EventTarget(), {
    dataset: {} as Record<string, string>,
    classList: { contains: (name: string) => name === "horizontal" },
    getBoundingClientRect: () => ({ left: 100, right: 140, top: 100, bottom: 140 }),
    querySelector: (selector: string) =>
      selector === ".weg-items-container"
        ? { clientWidth: 40 }
        : selector === ".weg-items"
        ? { offsetWidth: 40 }
        : null,
    querySelectorAll: () => [item],
  });
  const eventWindow = new EventTarget();
  class Observer {
    observe() {}
    disconnect() {}
  }
  Object.assign(globalThis, {
    window: eventWindow,
    innerWidth: 2560,
    innerHeight: 1440,
    matchMedia: () => Object.assign(new EventTarget(), { matches: true }),
    getComputedStyle: () => ({ getPropertyValue: () => "40" }),
    ResizeObserver: Observer,
    MutationObserver: Observer,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      pending.set(++nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame: (id: number) => pending.delete(id),
  });
  const tick = () => {
    time += 1000 / 144;
    const callbacks = [...pending.values()];
    pending.clear();
    callbacks.forEach((callback) => callback(time));
    assert.ok(pending.size <= 1);
  };
  const zoom = () => Number(properties.get("--dock-zoom") ?? "1");
  try {
    const controller = createDockMagnifier(node as unknown as HTMLElement);
    controller.approach(120, 120);
    tick();
    const first = zoom();
    tick(); // No new native/pointer event: smoothing must still advance.
    assert.ok(zoom() > first && zoom() < 1.5);
    node.dispatchEvent(new Event("pointerdown"));
    const frozen = zoom();
    controller.approach(0, 0);
    tick();
    assert.equal(zoom(), frozen);
    assert.equal(pending.size, 0);
    eventWindow.dispatchEvent(new Event("pointerup"));
    controller.approach(120, 120);
    for (let index = 0; index < 90; index++) tick();
    assert.equal(zoom(), 1.5);
    assert.equal(pending.size, 0);
    controller.approach(0, 0);
    tick();
    assert.ok(zoom() > 1 && zoom() < 1.5);
    for (let index = 0; index < 90; index++) tick();
    assert.equal(properties.size, 0);
    assert.equal(pending.size, 0);
    controller.approach(120, 120);
    controller.destroy();
    assert.equal(pending.size, 0);
    assert.equal(node.dataset.magnification, undefined);
  } finally {
    globals.forEach((name, index) => {
      const descriptor = saved[index];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
});

test("smoothing follows elapsed time equally at 60 and 144 Hz and converges without overshoot", () => {
  const animate = (hz: number) => {
    let scale = 1;
    for (let frame = 0; frame < hz; frame++) scale += (1.5 - scale) * dockFrameBlend(1000 / hz);
    return scale;
  };
  assert.ok(Math.abs(animate(60) - animate(144)) < 1e-12);
  assert.ok(animate(144) <= 1.5 && animate(144) > 1.499);
  assert.equal(dockFrameBlend(0), 0);
  assert.ok(dockFrameBlend(1000 / 144) > 0);
});

const cells = Array.from({ length: 5 }, (_, index) => ({ center: index * 48, size: 40, magnifiable: true }));

test("approaching outside the dock increases smoothly and distant desktop areas have no effect", () => {
  const rect = { left: 100, right: 300, top: 100, bottom: 150 };
  assert.equal(dockProximity(200, 110, rect), 1);
  assert.ok(dockProximity(200, 80, rect) > dockProximity(200, 40, rect));
  assert.ok(dockProximity(200, 40, rect) > 0);
  assert.equal(dockProximity(200, 0, rect), 0);
  assert.equal(dockProximity(0, 110, rect), 0);
  assert.ok(dockProximity(80, 80, rect) > 0);
  assert.equal(magnifyDock(cells, 96, 100, 0)[2]!.scale, 1);
  assert.equal(magnifyDock(cells, 96, 100, 0.5)[2]!.scale, 1.25);
});

test("hovered app grows most, immediate neighbors grow less, and distant apps stay at rest", () => {
  const result = magnifyDock(cells, 96, 100);
  assert.equal(result[2]!.scale, 1.5);
  assert.ok(result[1]!.scale > result[0]!.scale);
  assert.ok(result[1]!.scale < result[2]!.scale);
  assert.equal(result[1]!.scale, result[3]!.scale);
  assert.deepEqual(magnifyDock(cells, 1000, 100).map((cell) => cell.scale), [1, 1, 1, 1, 1]);
});

test("expanded apps never overlap their neighbors, including a fixed-width player", () => {
  const withPlayer = [...cells, { center: 300, size: 160, magnifiable: false }];
  const result = magnifyDock(withPlayer, 192, 100);
  assert.equal(result[5]!.scale, 1);
  for (let index = 1; index < withPlayer.length; index++) {
    const a = withPlayer[index - 1]!;
    const b = withPlayer[index]!;
    const right = a.center + result[index - 1]!.offset + a.size * result[index - 1]!.scale / 2;
    const left = b.center + result[index]!.offset - b.size * result[index]!.scale / 2;
    assert.ok(left >= right);
  }
});

test("empty docks, disabled radius and menu cells remain stable", () => {
  assert.deepEqual(magnifyDock([], 0, 100), []);
  assert.ok(magnifyDock(cells, 96, 0).every((cell) => cell.scale === 1 && cell.offset === 0));
  assert.deepEqual(magnifyDock([{ center: 0, size: 40, magnifiable: false }], 0, 100), [{ scale: 1, offset: 0 }]);
});

test("wide media player grows gently, influences neighbors and preserves their gap", () => {
  const withPlayer = [...cells, { center: 300, size: 160, magnifiable: true, maxScale: 1.2, inset: 60 }];
  const result = magnifyDock(withPlayer, 300, 160);
  assert.equal(result[5]!.scale, 1.2);
  assert.ok(result[4]!.scale > 1 && result[4]!.scale < 1.5);
  const appRight = cells[4]!.center + result[4]!.offset + 20 * result[4]!.scale;
  const playerLeft = 300 + result[5]!.offset - 80 * result[5]!.scale;
  assert.ok(playerLeft >= appRight);
  assert.ok(magnifyDock(withPlayer, 192, 100)[5]!.scale > 1);
});
