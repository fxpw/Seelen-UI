/** Reject stale, failed and uninitialized sensor snapshots independently of GPU sampling. */
export function cpuReading(snapshot, now = Date.now()) {
  if (!snapshot || !Number.isFinite(snapshot.sampledAt)) return null;
  const age = now - snapshot.sampledAt;
  if (age < 0 || age >= 10000 || snapshot.error) return null;
  if (!Number.isFinite(snapshot.temperature) || snapshot.temperature <= 0) return null;
  if (typeof snapshot.source !== "string" || !/^\/(amdcpu|intelcpu|cpu)\//.test(snapshot.source)) return null;
  return {
    temperature: snapshot.temperature,
    source: snapshot.source,
    name: snapshot.name ?? null,
    provider: snapshot.provider ?? "hardware sensor",
    sampledAt: snapshot.sampledAt,
  };
}
