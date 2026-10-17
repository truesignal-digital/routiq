import { within } from "@testing-library/react";

/**
 * The filled buttons inside a part of a record page (the default variant).
 * A record header holds at most one (#662).
 */
export function filledButtons(root: HTMLElement): HTMLElement[] {
  return within(root)
    .queryAllByRole("button")
    .filter((button) => /(^|\s)bg-primary(\s|$)/.test(button.className));
}

/** The record header of the page under test. */
export function recordHeader(): HTMLElement {
  const header = document.querySelector<HTMLElement>('[data-slot="record-header"]');
  if (header === null) throw new Error("no record header on the page");
  return header;
}
