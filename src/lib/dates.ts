export function short(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function stamp(d: Date) {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function untilDays(d: Date, from = new Date()) {
  return Math.max(0, Math.ceil((d.getTime() - from.getTime()) / 86400_000));
}
