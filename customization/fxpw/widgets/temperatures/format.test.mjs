import assert from "node:assert/strict";
import test from "node:test";
import { temperatureLabel } from "./format.mjs";

test("real readings are shown, unavailable CPU is not fabricated", () => {
  assert.equal(temperatureLabel({ sampledAt: 100, gpu: { temperature: 49.4 }, cpu: null }, 200), "CPU — · GPU 49°");
});

test("disabled CPU is omitted while GPU freshness checks remain active", () => {
  const data = { sampledAt: 100, cpuEnabled: false, cpu: { temperature: 70 }, gpu: { temperature: 49.4 } };
  assert.equal(temperatureLabel(data, 200), "GPU 49°");
  assert.equal(temperatureLabel(data, 20100), "GPU —");
});
test("expired, future and non-finite readings are not shown", () => {
  assert.equal(temperatureLabel({ sampledAt: 100, gpu: { temperature: 49 } }, 20100), "CPU — · GPU —");
  assert.equal(temperatureLabel({ sampledAt: 500, gpu: { temperature: 49 } }, 200), "CPU — · GPU —");
  assert.equal(
    temperatureLabel({ sampledAt: 100, cpu: { temperature: NaN }, gpu: { temperature: Infinity } }, 200),
    "CPU — · GPU —",
  );
});
