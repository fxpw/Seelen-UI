import assert from "node:assert/strict";
import test from "node:test";
import { isDockRevealPoint } from "./reveal.ts";

const monitor = { left: 2560, top: 0, right: 5120, bottom: 1440 };
const bottomDock = { left: 2560, top: 1336, right: 5120, bottom: 1408 };
const panel = { left: 3300, top: 1344, right: 4300, bottom: 1400 };

test("the lower toolbar strip reveals the dock, not the pixels above it", () => {
  assert.equal(isDockRevealPoint({ x: 3840, y: 1439 }, monitor, bottomDock, "Bottom", panel), true);
  assert.equal(isDockRevealPoint({ x: 2600, y: 1420 }, monitor, bottomDock, "Bottom", panel), true);
  assert.equal(isDockRevealPoint({ x: 5000, y: 1420 }, monitor, bottomDock, "Bottom", panel), true);
  assert.equal(isDockRevealPoint({ x: 3840, y: 1408 }, monitor, bottomDock, "Bottom", panel), true);
  assert.equal(isDockRevealPoint({ x: 3840, y: 1407 }, monitor, bottomDock, "Bottom", panel), false);
  assert.equal(isDockRevealPoint({ x: 3840, y: 1405 }, monitor, bottomDock, "Bottom", panel), false);
  assert.equal(isDockRevealPoint({ x: 3840, y: 1200 }, monitor, bottomDock, "Bottom", panel), false);
});

test("one monitor cannot trigger the dock on its neighbour or beyond its physical boundary", () => {
  assert.equal(isDockRevealPoint({ x: 2559, y: 1439 }, monitor, bottomDock, "Bottom", panel), false);
  assert.equal(isDockRevealPoint({ x: 5120, y: 1439 }, monitor, bottomDock, "Bottom", panel), false);
  assert.equal(isDockRevealPoint({ x: 3840, y: 1440 }, monitor, bottomDock, "Bottom", panel), false);
});

test("without a toolbar, only the actual dock width has an edge activation zone", () => {
  const edgeDock = { ...bottomDock, bottom: monitor.bottom };
  assert.equal(isDockRevealPoint({ x: 2600, y: 1439 }, monitor, edgeDock, "Bottom", panel), false);
  assert.equal(isDockRevealPoint({ x: 5000, y: 1439 }, monitor, edgeDock, "Bottom", panel), false);
  assert.equal(isDockRevealPoint({ x: 3300, y: 1439 }, monitor, edgeDock, "Bottom", panel), true);
  assert.equal(isDockRevealPoint({ x: 4300, y: 1439 }, monitor, edgeDock, "Bottom", panel), false);
  assert.equal(isDockRevealPoint({ x: 3840, y: 1439 }, monitor, edgeDock, "Bottom", null), false);
});

test("top and vertical docks use their inset edge, including negative screen coordinates", () => {
  const negative = { left: -1920, top: -1080, right: 0, bottom: 0 };
  const negativePanel = { left: -1200, top: -800, right: -200, bottom: -200 };
  assert.equal(
    isDockRevealPoint({ x: -1000, y: -1060 }, negative, { ...negative, top: -1048 }, "Top", negativePanel),
    true,
  );
  assert.equal(
    isDockRevealPoint({ x: -1900, y: -500 }, negative, { ...negative, left: -1888 }, "Left", negativePanel),
    true,
  );
  assert.equal(
    isDockRevealPoint({ x: -20, y: -500 }, negative, { ...negative, right: -32 }, "Right", negativePanel),
    true,
  );
  assert.equal(isDockRevealPoint({ x: -1000, y: -500 }, negative, negative, "Top", negativePanel), false);
  assert.equal(isDockRevealPoint({ x: -1888, y: -100 }, negative, negative, "Left", negativePanel), false);
});
