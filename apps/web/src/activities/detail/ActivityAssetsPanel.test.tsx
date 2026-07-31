// @vitest-environment jsdom
import type { ActivityDetail } from "@routiq/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { i18n } from "../../i18n/index.js";
import {
  ActivityAssetsPanel,
  readingSpans,
  type ActivityAssetsPanelData,
} from "./ActivityAssetsPanel.js";

type Reading = ActivityDetail["readings"][number];

const SEGMENT_ID = "00000000-0000-4000-8000-000000000011";
const ASSET_ID = "00000000-0000-4000-8000-000000000012";
const PERSON_ID = "00000000-0000-4000-8000-000000000013";

function reading(overrides: Partial<Reading> = {}): Reading {
  return {
    readingType: "ODOMETER",
    value: 128_400,
    observedAt: "2026-07-18T06:00:00.000Z",
    source: "ACTIVITY_START",
    supersededById: null,
    ...overrides,
  };
}

function panel(
  overrides: Partial<ActivityAssetsPanelData> = {},
): ActivityAssetsPanelData {
  return {
    segments: [
      {
        id: SEGMENT_ID,
        assetId: ASSET_ID,
        assetCode: "CAMION-03",
        role: "PRIMARY",
        startedAt: "2026-07-18T06:00:00.000Z",
        endedAt: "2026-07-18T18:00:00.000Z",
        substitutesSegmentId: null,
        rowVersion: 1,
      },
    ],
    crew: [{ personId: PERSON_ID, displayName: "Amadou Bello", role: "DRIVER" }],
    readings: [
      reading(),
      reading({
        value: 128_640,
        observedAt: "2026-07-18T18:00:00.000Z",
        source: "ACTIVITY_END",
      }),
    ],
    ...overrides,
  };
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

afterEach(cleanup);

describe("readingSpans", () => {
  it("spans the earliest live reading to the latest, per meter", () => {
    const spans = readingSpans([
      reading({ value: 100, observedAt: "2026-07-18T06:00:00.000Z" }),
      reading({ value: 340, observedAt: "2026-07-18T18:00:00.000Z" }),
      reading({ readingType: "HOURS", value: 9, observedAt: "2026-07-18T06:00:00.000Z" }),
    ]);

    expect(spans.map((span) => span.readingType)).toEqual(["ODOMETER", "HOURS"]);
    expect(spans[0]?.from.value).toBe(100);
    expect(spans[0]?.to?.value).toBe(340);
    // One reading is a point, not a span — there is nothing to subtract from it.
    expect(spans[1]?.to).toBeNull();
  });

  it("keeps a superseded reading out of the span it was corrected off", () => {
    const spans = readingSpans([
      reading({
        value: 999_999,
        observedAt: "2026-07-18T18:00:00.000Z",
        supersededById: "00000000-0000-4000-8000-0000000000ff",
      }),
      reading({ value: 100, observedAt: "2026-07-18T06:00:00.000Z" }),
      reading({ value: 340, observedAt: "2026-07-18T19:00:00.000Z" }),
    ]);

    expect(spans[0]?.to?.value).toBe(340);
  });
});

describe("activity assets panel", () => {
  it("renders nothing when there is no asset, crew or reading", () => {
    const { container } = render(
      <ActivityAssetsPanel activity={panel({ segments: [], crew: [], readings: [] })} />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("shows the asset, the crew and the meter span with its difference", () => {
    render(<ActivityAssetsPanel activity={panel()} />);

    expect(screen.getByText("CAMION-03")).toBeTruthy();
    expect(screen.getByText(/Amadou Bello/)).toBeTruthy();
    expect(screen.getByText("Odometer")).toBeTruthy();
    expect(screen.getByText(/\+240 km/)).toBeTruthy();
  });

  it("folds corrected readings away without dropping them", () => {
    render(
      <ActivityAssetsPanel
        activity={panel({
          readings: [
            reading(),
            reading({
              value: 999_999,
              observedAt: "2026-07-18T17:00:00.000Z",
              source: "ACTIVITY_END",
              supersededById: "00000000-0000-4000-8000-0000000000ff",
            }),
            reading({
              value: 128_640,
              observedAt: "2026-07-18T18:00:00.000Z",
              source: "ACTIVITY_END",
            }),
          ],
        })}
      />,
    );

    const disclosure = screen.getByText("1 corrected reading");
    expect(disclosure.closest("details")).toBeTruthy();
    // The superseded value stays on the page, struck through, never erased.
    expect(screen.getByText(/999,999/)).toBeTruthy();
  });

  it("survives an activity that has readings but no asset row", () => {
    render(<ActivityAssetsPanel activity={panel({ segments: [], crew: [] })} />);

    expect(screen.getByText("Meter readings")).toBeTruthy();
    expect(screen.queryByText("CAMION-03")).toBeNull();
  });
});
