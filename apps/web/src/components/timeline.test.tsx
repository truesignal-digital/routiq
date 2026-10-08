// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { useTranslation } from "react-i18next";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { i18n } from "../i18n/index.js";
import { historyNote, Timeline, timelineAct } from "./timeline.js";

const ACTOR = {
  principalId: "00000000-0000-4000-8000-000000000002",
  displayName: "Hervé Mbarga",
  scope: "WORKSPACE" as const,
};

function Harness({ kind, note }: { kind: string; note: string | null }) {
  const { t } = useTranslation();
  return createElement(Timeline, {
    events: [
      {
        id: "00000000-0000-4000-8000-000000000021",
        occurredAt: "2026-10-03T09:15:00.000Z",
        actor: ACTOR,
        act: timelineAct(kind, t),
        note: historyNote({ note, noteCode: null }, t),
      },
    ],
  });
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterEach(() => cleanup());

describe("Timeline (#308)", () => {
  it("renders the actor, the act, the decision note under it and the time", () => {
    render(createElement(Harness, { kind: "work_order.approved", note: "Checked by Hervé" }));

    expect(screen.getByText("Work order approved")).toBeTruthy();
    expect(screen.getByText("Checked by Hervé")).toBeTruthy();
    expect(screen.getByText("Hervé Mbarga")).toBeTruthy();
    expect(document.querySelector('time[datetime="2026-10-03T09:15:00.000Z"]')).not.toBeNull();
  });

  it("words an unknown event kind as Other change, never the raw code", () => {
    render(createElement(Harness, { kind: "work_order.teleported", note: null }));

    expect(screen.getByText("Other change")).toBeTruthy();
    expect(screen.queryByText(/teleported/)).toBeNull();
  });

  it("says Autre modification in French", async () => {
    await i18n.changeLanguage("fr");
    render(createElement(Harness, { kind: "work_order.teleported", note: null }));
    expect(screen.getByText("Autre modification")).toBeTruthy();
    await i18n.changeLanguage("en");
  });
});
