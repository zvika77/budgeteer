import "server-only";

export function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const JERUSALEM_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function toJerusalemDate(iso: string): string {
  return JERUSALEM_DATE.format(new Date(iso));
}

export function jerusalemToday(): string {
  return toJerusalemDate(new Date().toISOString());
}

export function monthStart(localDate: string): string {
  return `${localDate.slice(0, 7)}-01`;
}

export function monthEnd(localDate: string): string {
  const [y, m] = localDate.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${localDate.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
}

export function shiftMonth(localDate: string, delta: number): string {
  const [y, m] = localDate.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1 + delta, 1));
  const yy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}-01`;
}
