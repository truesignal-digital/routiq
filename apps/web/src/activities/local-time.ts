/**
 * A `datetime-local` input yields a wall clock with no zone, and every activity
 * command requires `z.iso.datetime({ offset: true })`. Stamping the offset here
 * keeps the ambiguity out of the payload: 18:30 in Douala stays 18:30+01:00.
 */
export function toOffsetIso(local: string, offsetMinutes: number): string {
  const [datePart = "", timePart = "00:00"] = local.split("T");
  const [hours = "00", minutes = "00", seconds = "00"] = timePart.split(":");
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const offsetRest = String(absolute % 60).padStart(2, "0");
  return `${datePart}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetRest}`;
}

/** Minutes east of UTC for the browser's own zone at that wall clock. */
export function localOffsetMinutes(local: string): number {
  const parsed = new Date(local);
  return Number.isNaN(parsed.getTime()) ? 0 : -parsed.getTimezoneOffset();
}

export function localToIso(local: string): string {
  return toOffsetIso(local, localOffsetMinutes(local));
}

/** A `datetime-local` value for right now, in the operator's own zone. */
export function nowLocal(): string {
  const now = new Date();
  const shifted = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/** A `date` value for today, in the operator's own zone. */
export function todayLocal(): string {
  return nowLocal().slice(0, 10);
}

/** A meter or distance typed as text: a whole, non-negative number or nothing. */
export function wholeNumber(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
