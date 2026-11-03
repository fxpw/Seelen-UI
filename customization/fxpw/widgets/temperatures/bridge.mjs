import { execFile } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { temperatureLabel } from "./format.mjs";
import { cpuReading } from "./cpu-reading.mjs";

const exec = promisify(execFile);
const root = join(process.env.LOCALAPPDATA, "fxpw-seelen", "sensors");
await mkdir(root, { recursive: true });
// Reuse only when explicitly requested for an in-place collector update. Existing
// widgets keep their URL and authentication; no panel reload or layout changes.
const configFile = join(root, "bridge.json");
const previous = process.argv.includes("--reuse-config") ? JSON.parse(await readFile(configFile, "utf8")) : null;
if (
  previous &&
  (!Number.isInteger(previous.port) || previous.port < 1024 || previous.port > 65535 ||
    !/^[a-f0-9]{64}$/.test(previous.token))
) {
  throw new Error("Invalid existing sensor endpoint configuration");
}
const token = previous?.token ?? randomBytes(32).toString("hex");
const data = { sampledAt: 0, gpu: null, cpu: { temperature: null, source: null } };
let cpuSampledAt = 0;
let fallbackCpu = null;
let sampling = false;

async function sample() {
  if (sampling) return;
  sampling = true;
  try {
    try {
      const { stdout } = await exec("nvidia-smi.exe", [
        "--query-gpu=name,temperature.gpu,utilization.gpu",
        "--format=csv,noheader,nounits",
      ], { windowsHide: true, timeout: 4000, maxBuffer: 16384 });
      const [name, temperature, usage] = stdout.trim().split("\n")[0].split(",").map((value) => value.trim());
      data.gpu = { name, temperature: numberOrNull(temperature), usage: numberOrNull(usage) };
    } catch {
      data.gpu = null;
    }
    let cpu = null;
    try {
      cpu = cpuReading(JSON.parse(await readFile(join(root, "cpu.json"), "utf8")));
    } catch {
      // The optional elevated helper may be stopped or not installed.
    }
    if (!cpu && Date.now() - cpuSampledAt >= 30000) {
      try {
        const { stdout } = await exec("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-File",
          fileURLToPath(new URL("./sensors.ps1", import.meta.url)),
        ], { windowsHide: true, timeout: 10000, maxBuffer: 16384 });
        const reading = JSON.parse(stdout.trim());
        fallbackCpu = reading.temperature > 0 ? { ...reading, sampledAt: Date.now() } : null;
      } catch {
        fallbackCpu = null;
      }
      cpuSampledAt = Date.now();
    }
    data.cpu = cpu ?? (Date.now() - cpuSampledAt < 20000 ? fallbackCpu : null);
    data.sampledAt = Date.now();
  } finally {
    sampling = false;
  }
}

function numberOrNull(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const allowedOrigins = new Set(["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"]);
const server = createServer((request, response) => {
  const origin = request.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    response.writeHead(403).end();
    return;
  }
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "OPTIONS") {
    response.setHeader("Access-Control-Allow-Methods", "GET");
    response.setHeader("Access-Control-Allow-Headers", "Authorization");
    response.writeHead(204).end();
    return;
  }
  const supplied = Buffer.from(request.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    response.writeHead(401).end();
    return;
  }
  if (request.method !== "GET" || !["/metrics", "/fxpw-temperatures/label"].includes(request.url)) {
    response.writeHead(404).end();
    return;
  }
  const snapshot = structuredClone(data);
  if (snapshot.cpu && Date.now() - snapshot.cpu.sampledAt >= 20000) snapshot.cpu = null;
  if (request.url.endsWith("/label")) {
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end(temperatureLabel(snapshot));
  } else {
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(snapshot));
  }
});

await sample();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(previous?.port ?? 0, "127.0.0.1", resolve);
});
const config = { pid: process.pid, port: server.address().port, token };
await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
setInterval(sample, 5000);
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => process.exit(0)));
