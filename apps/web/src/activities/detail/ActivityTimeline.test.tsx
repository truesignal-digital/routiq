// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { i18n } from "../../i18n/index.js";
import {
  ActivityTimeline,
  timelineBar,
  type ActivityTimelineData,
} from "./ActivityTimeline.js";

function timeline(
  overrides: Partial<ActivityTimelineData> = {},
): ActivityTimelineData {
  return {
    status: "CLOSED",
    plannedStartAt: "2026-07-18T06:00:00.000Z",
    plannedEndAt: "2026-07-18T16:00:00.000Z",
    startedAt: "2026-07-18T07:00:00.000Z",
    endedAt: "2026-07-18T18:00:00.000Z",
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

describe("timelineBar", () => {
  const scale = { min: 0, max: 100 };

  it("places a span as a share of the scale", () => {
    expect(timelineBar(25, 75, scale)).toEqual({ leftPct: 25, widthPct: 50 });
  });

  it("runs an unfinished span to the end of the scale", () => {
    expect(timelineBar(40, null, scale)).toEqual({ leftPct: 40, widthPct: 60 });
  });

  it("keeps an instant visible instead of collapsing it to nothing", () => {
    const bar = timelineBar(100, 100, scale);
    expect(bar?.widthPct).toBeGreaterThan(0);
    // …without letting it spill past the track.
    expect((bar?.leftPct ?? 0) + (bar?.widthPct ?? 0)).toBeLessThanOrEqual(100);
  });

  it("has nothing to draw without a start", () => {
    expect(timelineBar(null, 50, scale)).toBeNull();
  });
});

describe("activity timeline", () => {
  it("renders nothing when the activity was never planned", () => {
    const { container } = render(
      <ActivityTimeline
        activity={timeline({ plannedStartAt: null, plannedEndAt: null })}
      />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("shows planned against actual once a plan exists", () => {
    render(<ActivityTimeline activity={timeline()} />);

    expect(screen.getByText("Planned")).toBeTruthy();
    expect(screen.getByText("Actual")).toBeTruthy();
  });

  it("dashes a running activity's end instead of inventing one (#94)", () => {
    render(
      <ActivityTimeline activity={timeline({ status: "OPEN", endedAt: null })} />,
    );

    expect(screen.getByText(/→ —$/)).toBeTruthy();
    expect(screen.queryByText(/still running/)).toBeNull();
  });

  it("animates the running bar only when motion is welcome", () => {
    const { container } = render(
      <ActivityTimeline activity={timeline({ status: "OPEN", endedAt: null })} />,
    );

    const animated = container.querySelector(".motion-safe\\:animate-pulse");
    expect(animated).toBeTruthy();
    expect(container.querySelector(".animate-pulse:not(.motion-safe\\:animate-pulse)"))
      .toBeNull();
  });

  it("says so plainly when the activity never started", () => {
    render(
      <ActivityTimeline
        activity={timeline({ status: "OPEN", startedAt: null, endedAt: null })}
      />,
    );

    expect(screen.getByText("Not recorded")).toBeTruthy();
  });
});
