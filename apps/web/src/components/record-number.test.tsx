// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RecordNumber, RecordText } from "./record-number";

afterEach(cleanup);

const numbersIn = (container: HTMLElement) =>
  [...container.querySelectorAll("[data-record-number]")].map((node) => ({
    text: node.textContent,
    nowrap: node.classList.contains("whitespace-nowrap"),
  }));

describe("RecordNumber", () => {
  it("keeps a record number on one line", () => {
    const { container } = render(<RecordNumber>DLA-2026-00003</RecordNumber>);
    expect(numbersIn(container)).toEqual([{ text: "DLA-2026-00003", nowrap: true }]);
  });
});

describe("RecordText", () => {
  it("wraps the number wherever the translation put it and leaves the sentence as written", () => {
    const en = render(<RecordText text="Leg recorded on trip DLA-2026-00003" numbers={["DLA-2026-00003"]} />);
    expect(en.container.textContent).toBe("Leg recorded on trip DLA-2026-00003");
    expect(numbersIn(en.container)).toEqual([{ text: "DLA-2026-00003", nowrap: true }]);
    cleanup();

    const first = render(<RecordText text="DLA-2026-00003 : étape enregistrée" numbers={["DLA-2026-00003"]} />);
    expect(first.container.textContent).toBe("DLA-2026-00003 : étape enregistrée");
    expect(numbersIn(first.container)).toEqual([{ text: "DLA-2026-00003", nowrap: true }]);
  });

  it("wraps every named number, matches them literally, and renders plain text when none is present", () => {
    const both = render(
      <RecordText text="Entry YDE-2026-00012 for trip DLA-2026-00003.1" numbers={["DLA-2026-00003.1", "YDE-2026-00012", null, ""]} />,
    );
    expect(numbersIn(both.container).map((item) => item.text)).toEqual(["YDE-2026-00012", "DLA-2026-00003.1"]);
    cleanup();

    const none = render(<RecordText text="Problem reported" numbers={[undefined]} />);
    expect(none.container.textContent).toBe("Problem reported");
    expect(numbersIn(none.container)).toEqual([]);
  });
});
