import assert from "node:assert/strict";
import test from "node:test";
import { cycleTask, groupTasksByMonitor } from "./navigation.ts";

const left = { id: "left", isPrimary: true, rect: { left: 0, top: 0, right: 2560, bottom: 1440 } };
const right = { id: "right", isPrimary: false, rect: { left: 2560, top: 0, right: 5120, bottom: 1440 } };
const tasks = [
  { hwnd: 21, monitor: "right" },
  { hwnd: 11, monitor: "left" },
  { hwnd: 22, monitor: "right" },
  { hwnd: 12, monitor: "left" },
];

test("panels keep their own windows and MRU order, independent of monitor enumeration", () => {
  const groups = groupTasksByMonitor(tasks, [right, left]);
  assert.deepEqual(groups.map((group) => [group.monitor.id, group.windows.map((task) => task.hwnd)]), [
    ["left", [11, 12]],
    ["right", [21, 22]],
  ]);
  assert.deepEqual(tasks.map((task) => task.hwnd), [21, 11, 22, 12]);
});

test("forward selection crosses both monitor boundaries and wraps globally", () => {
  const ordered = groupTasksByMonitor(tasks, [left, right]).flatMap((group) => group.windows);
  assert.equal(cycleTask(ordered, 11, "next"), 12);
  assert.equal(cycleTask(ordered, 12, "next"), 21);
  assert.equal(cycleTask(ordered, 22, "next"), 11);
});

test("Shift+Alt+Tab and left-arrow use the same global reverse cycle", () => {
  const ordered = groupTasksByMonitor(tasks, [left, right]).flatMap((group) => group.windows);
  assert.equal(cycleTask(ordered, 21, "previous"), 12);
  assert.equal(cycleTask(ordered, 11, "previous"), 22);
});

test("empty monitors are skipped and an empty desktop has no selection", () => {
  const ordered = groupTasksByMonitor(tasks.filter((task) => task.monitor === "right"), [left, right])
    .flatMap((group) => group.windows);
  assert.equal(cycleTask(ordered, 22, "next"), 21);
  assert.equal(cycleTask([], null, "next"), null);
  assert.equal(cycleTask([], null, "previous"), null);
  assert.deepEqual(groupTasksByMonitor(tasks, []), []);
});

test("closed selection, hotplug and temporarily stale monitor IDs keep navigation valid", () => {
  const surviving = groupTasksByMonitor(tasks, [left]).flatMap((group) => group.windows);
  assert.equal(surviving.length, 4);
  assert.equal(cycleTask(surviving, 999, "next"), 21);
  assert.equal(cycleTask(surviving, 999, "previous"), 12);
  const deduplicated = groupTasksByMonitor([...tasks, tasks[0]!], [left, right]);
  assert.equal(deduplicated.flatMap((group) => group.windows).length, 4);
});

test("negative screen coordinates and moving a window preserve physical screen grouping", () => {
  const negative = { ...left, rect: { left: -2560, top: -200, right: 0, bottom: 1240 } };
  const groups = groupTasksByMonitor(tasks.map((task) => task.hwnd === 12 ? { ...task, monitor: "right" } : task), [
    right,
    negative,
  ]);
  assert.deepEqual(groups.map((group) => group.windows.map((task) => task.hwnd)), [[11], [21, 22, 12]]);
});
