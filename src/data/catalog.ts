export function fmt(sec: number) {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function formatCount(n: number) {
  return Math.round(n).toLocaleString("en-US");
}
