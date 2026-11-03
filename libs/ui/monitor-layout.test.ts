// In-memory implementations intentionally preserve the asynchronous file API.
// deno-lint-ignore-file require-await
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isSameMonitor, MonitorLayout, monitorLayoutFilename, type PanelLayout } from "./monitor-layout.ts";

const layout = (value: string): PanelLayout => ({
  isReorderDisabled: false,
  left: [value],
  center: [],
  right: [],
});

function memoryFiles() {
  const data = new Map<string, string>();
  return {
    data,
    async read(filename: string) {
      if (!data.has(filename)) throw new Error("The system cannot find the file (os error 2)");
      return data.get(filename)!;
    },
    async write(filename: string, content: string) {
      data.set(filename, content);
    },
  };
}

test("monitor changes survive restart without changing another monitor or the legacy layout", async () => {
  const files = memoryFiles();
  const original = layout("original");
  const left = new MonitorLayout("left", files, async () => original);
  const right = new MonitorLayout("right", files, async () => original);
  await Promise.all([left.load(), right.load()]);
  await left.save(layout("WSL"));
  await right.save(layout("calendar"));
  assert.deepEqual(await new MonitorLayout("left", files, async () => original).load(), layout("WSL"));
  assert.deepEqual(await right.load(), layout("calendar"));
  assert.deepEqual(original, layout("original"));
});

test("an intentionally empty panel is preserved", async () => {
  const files = memoryFiles();
  const store = new MonitorLayout("left", files, async () => layout("default"));
  const empty = { ...layout("default"), left: [] };
  await store.save(empty);
  assert.deepEqual(await store.load(), empty);
});

test("corrupt, mismatched and inaccessible profiles are never replaced", async () => {
  for (const content of ["{broken", JSON.stringify({ version: 1, monitorId: "other", layout: layout("x") })]) {
    const files = memoryFiles();
    files.data.set(monitorLayoutFilename("left"), content);
    const store = new MonitorLayout("left", files, async () => layout("fallback"));
    await assert.rejects(store.load());
    assert.equal(files.data.get(store.filename), content);
  }
  let writes = 0;
  const store = new MonitorLayout("left", {
    read: async () => {
      throw new Error("Access denied (os error 5)");
    },
    write: async () => {
      writes++;
    },
  }, async () => layout("fallback"));
  await assert.rejects(store.load(), /Access denied/);
  assert.equal(writes, 0);
});

test("writes preserve order, snapshot arguments, and recover after failure", async () => {
  const writes: string[] = [];
  const store = new MonitorLayout("left", {
    read: async () => {
      throw new Error("unused");
    },
    async write(_filename, content) {
      const value = JSON.parse(content).layout.left[0];
      if (value === "fail") throw new Error("disk full");
      await new Promise((resolve) => setTimeout(resolve, value === "first" ? 15 : 0));
      writes.push(value);
    },
  }, async () => layout("default"));
  const value = layout("first");
  const first = store.save(value);
  value.left[0] = "mutated";
  const second = store.save(layout("second"));
  await Promise.all([first, second]);
  await assert.rejects(store.save(layout("fail")), /disk full/);
  await store.save(layout("last"));
  assert.deepEqual(writes, ["first", "second", "last"]);
});

test("filenames and sync messages respect monitor identity", () => {
  assert.equal(monitorLayoutFilename("../display\\2"), "fxpw-monitor-..%2Fdisplay%5C2.json");
  assert.throws(() => monitorLayoutFilename(""));
  assert.equal(isSameMonitor("left", "right"), false);
  assert.equal(isSameMonitor("left", undefined), false);
  assert.equal(isSameMonitor("left", "left"), true);
});
