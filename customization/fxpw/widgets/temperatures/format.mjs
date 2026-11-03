export function temperatureLabel(data, now = Date.now()) {
  const fresh = data && now - data.sampledAt >= 0 && now - data.sampledAt < 20000;
  const format = (reading) => {
    const sampledAt = reading?.sampledAt ?? data?.sampledAt;
    const readingFresh = now - sampledAt >= 0 && now - sampledAt < 20000;
    return fresh && readingFresh && typeof reading?.temperature === "number" && Number.isFinite(reading.temperature)
      ? `${Math.round(reading.temperature)}°`
      : "—";
  };
  return `CPU ${format(data?.cpu)} · GPU ${format(data?.gpu)}`;
}
