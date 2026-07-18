// Reproducible build label. Accepts SOURCE_DATE_EPOCH as Unix seconds (the
// convention) OR an ISO date string; anything unparseable falls back to a
// stable label rather than throwing (RangeError: Invalid time value).
export function buildStamp(epoch = process.env.SOURCE_DATE_EPOCH) {
  if (epoch) {
    const secs = Number(epoch);
    if (Number.isFinite(secs) && secs > 0) return new Date(secs * 1000).toISOString();
    const iso = new Date(epoch);
    if (!Number.isNaN(iso.getTime())) return iso.toISOString();
  }
  return "build";
}
