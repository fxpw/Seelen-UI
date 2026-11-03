import assert from "node:assert/strict";
import test from "node:test";
import { cpuReading } from "./cpu-reading.mjs";
import { temperatureLabel } from "./format.mjs";

const sample = {
  sampledAt: 1000,
  temperature: 61.375,
  source: "/amdcpu/0/temperature/2",
  name: "Core (Tctl/Tdie)",
  provider: "LibreHardwareMonitor 0.9.6",
  error: null,
};

test("Ryzen package reading keeps its actual value and sensor identity", () => {
  assert.deepEqual(cpuReading(sample, 2000), {
    temperature: 61.375,
    source: sample.source,
    name: sample.name,
    provider: sample.provider,
    sampledAt: 1000,
  });
});

test("stopped collectors, failed driver access and motherboard sensors do not become CPU readings", () => {
  for (
    const snapshot of [
      null,
      {},
      { ...sample, sampledAt: 11001 },
      { ...sample, sampledAt: 0 },
      { ...sample, temperature: 0 },
      { ...sample, temperature: NaN },
      { ...sample, temperature: null },
      { ...sample, temperature: Infinity },
      { ...sample, error: "Driver access failed" },
      { ...sample, source: "/lpc/nct6798d/temperature/0" },
    ]
  ) assert.equal(cpuReading(snapshot, 10000), null);
  assert.equal(cpuReading(sample, 11000), null);
});

test("a fresh GPU update cannot keep an old CPU temperature alive", () => {
  assert.equal(
    temperatureLabel({
      sampledAt: 20000,
      cpu: { ...sample, sampledAt: 0 },
      gpu: { temperature: 49 },
    }, 20000),
    "CPU — · GPU 49°",
  );
});
