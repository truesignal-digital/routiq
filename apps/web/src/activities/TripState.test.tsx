// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { i18n } from "../i18n/index.js";
import { TripState, type TripStateFacts } from "./TripState.js";

const open: TripStateFacts = { status: "OPEN", completeness: null, completenessCodes: [] };
const closed: TripStateFacts = { status: "CLOSED", completeness: "COMPLETE", completenessCodes: [] };
const closedWithGaps: TripStateFacts = {
  status: "CLOSED",
  completeness: "COMPLETE_WITH_EXCEPTIONS",
  completenessCodes: ["ACTIVITY_MISSING_CREW", "ACTIVITY_NO_REVENUE"],
};

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

afterEach(cleanup);

describe("trip state", () => {
  it("names each trip's state with one label", () => {
    const { unmount } = render(<TripState trip={open} />);
    expect(screen.getByText("On the road")).toBeTruthy();
    unmount();

    render(<TripState trip={closed} />);
    expect(screen.getByText("Closed")).toBeTruthy();
  });

  it("folds the gaps of a trip closed with exceptions into its one label", () => {
    render(<TripState trip={closedWithGaps} />);

    expect(screen.getByText("Closed, 2 gaps")).toBeTruthy();
  });

  it("speaks French by default", async () => {
    await i18n.changeLanguage("fr-CM");
    try {
      render(<TripState trip={open} />);
      expect(screen.getByText("En route")).toBeTruthy();
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
