import type { ReactNode } from "react";

/**
 * A record number (trip, entry, work order) on screen. It never breaks across
 * lines: people search for it and read it aloud, and "DLA-2026-" / "00003"
 * would otherwise split at a hyphen on a phone.
 */
export function RecordNumber({ children }: { children: string }) {
  return (
    <span data-record-number="" className="whitespace-nowrap">
      {children}
    </span>
  );
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A translated sentence that names records, such as "Leg recorded on trip
 * {number}". Pass the already translated text and the numbers it was given:
 * the sentence still wraps, each number stays whole. The number is found in
 * the text rather than by position, because each language puts it where its
 * grammar wants.
 */
export function RecordText({
  text,
  numbers,
}: {
  text: string;
  numbers: readonly (string | null | undefined)[];
}): ReactNode {
  const present = [...new Set(numbers)]
    .filter((number): number is string => typeof number === "string" && number !== "" && text.includes(number))
    .sort((a, b) => b.length - a.length);
  if (present.length === 0) return text;
  const parts = text.split(new RegExp(`(${present.map(escapeRegExp).join("|")})`));
  return parts.map((part, index) =>
    index % 2 === 1 ? <RecordNumber key={index}>{part}</RecordNumber> : part,
  );
}
