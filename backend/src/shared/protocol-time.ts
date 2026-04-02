/**
 * Protocol V2.4 timestamp utilities.
 * V2.4 uses UTC-3 business time strings "YYYY-MM-DD HH:mm:ss".
 * V1.x used epoch milliseconds as a string.
 */

/** Parse a protocol timestamp (V2.4 UTC-3 string or V1.x epoch ms) into a Date. */
export function parseProtocolTimestamp(timeStampStr: string): Date {
  // V1.x epoch ms compat: pure digits ≥10 chars
  if (/^\d{10,}$/.test(timeStampStr)) {
    const ms = Number(timeStampStr);
    const d = new Date(ms);
    if (isNaN(d.getTime())) throw new Error(`Invalid epoch ms: "${timeStampStr}"`);
    return d;
  }
  // V2.4 UTC-3 string: must match "YYYY-MM-DD HH:mm:ss"
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timeStampStr)) {
    throw new Error(`Invalid V2.4 timestamp: "${timeStampStr}"`);
  }
  const isoWithOffset = timeStampStr.replace(" ", "T") + "-03:00";
  const d = new Date(isoWithOffset);
  if (isNaN(d.getTime())) throw new Error(`Invalid V2.4 timestamp: "${timeStampStr}"`);
  return d;
}

/** Format a Date as V2.4 UTC-3 business time "YYYY-MM-DD HH:mm:ss". */
export function formatProtocolTimestamp(date: Date = new Date()): string {
  const utc3 = new Date(date.getTime() - 3 * 3600_000);
  const Y = utc3.getUTCFullYear();
  const M = String(utc3.getUTCMonth() + 1).padStart(2, "0");
  const D = String(utc3.getUTCDate()).padStart(2, "0");
  const h = String(utc3.getUTCHours()).padStart(2, "0");
  const m = String(utc3.getUTCMinutes()).padStart(2, "0");
  const s = String(utc3.getUTCSeconds()).padStart(2, "0");
  return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}

/** Convert epoch milliseconds to V2.4 UTC-3 business time string. */
export function epochMsToProtocolTimestamp(ms: number): string {
  return formatProtocolTimestamp(new Date(ms));
}
