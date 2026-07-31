// @vitest-environment jsdom
import type { ActivityDetail } from "@routiq/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { i18n } from "../../i18n/index.js";
import { ActivityLegs } from "./ActivityLegs.js";

type Leg = ActivityDetail["legs"][number];

function leg(overrides: Partial<Leg> = {}): Leg {
  return {
    id: "00000000-0000-4000-8000-000000000021",
    legNo: 1,
    segmentId: null,
    originPlaceId: null,
    originName: "Douala",
    destinationPlaceId: null,
    destinationName: "Edéa",
    departedAt: "2026-07-18T06:00:00.000Z",
    arrivedAt: "2026-07-18T09:00:00.000Z",
    distanceKm: 240,
    loadState: "LADEN",
    passengerCount: null,
    customValues: {},
    ...overrides,
  };
}

function headers(): string[] {
  return screen
    .getAllByRole("columnheader")
    .map((cell) => (cell.textContent ?? "").trim());
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

afterEach(cleanup);

describe("activity legs table", () => {
  it("renders nothing when no leg was recorded", () => {
    const { container } = render(<ActivityLegs legs={[]} />);

    expect(container.innerHTML).toBe("");
  });

  it("lists every leg with both ends of the route", () => {
    render(
      <ActivityLegs
        legs={[
          leg(),
          leg({
            id: "00000000-0000-4000-8000-000000000022",
            legNo: 2,
            originName: "Edéa",
            destinationName: "Douala",
            loadState: "EMPTY",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Douala → Edéa")).toBeTruthy();
    expect(screen.getByText("Edéa → Douala")).toBeTruthy();
    expect(screen.getByText("Laden")).toBeTruthy();
    expect(screen.getByText("Empty")).toBeTruthy();
  });

  it("drops the columns no leg filled in", () => {
    render(
      <ActivityLegs
        legs={[
          leg({
            departedAt: null,
            arrivedAt: null,
            distanceKm: null,
            loadState: null,
            passengerCount: null,
          }),
        ]}
      />,
    );

    expect(headers()).toEqual(["No.", "Route"]);
  });

  it("adds the passenger column only when someone counted passengers", () => {
    render(<ActivityLegs legs={[leg({ passengerCount: 54 })]} />);

    expect(headers()).toContain("Passengers");
    expect(screen.getByText("54")).toBeTruthy();
  });
});
