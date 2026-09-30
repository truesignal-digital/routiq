// @vitest-environment jsdom
import type { FinancialEntryListItem } from "@routiq/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    search,
    children,
    ...props
  }: {
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
    children?: ReactNode;
  }) => {
    const path = Object.entries(params ?? {}).reduce(
      (built, [key, value]) => built.replace(`$${key}`, value),
      to,
    );
    const query = new URLSearchParams(search ?? {}).toString();
    return (
      <a href={query === "" ? path : `${path}?${query}`} {...props}>
        {children}
      </a>
    );
  },
}));

const { EntryLinks } = await import("./EntryLinks.js");

const WORK_ORDER_ID = "3f1a9c40-0000-4000-8000-0000000000c1";
const ASSET_ID = "00000000-0000-4000-8000-0000000000a1";
const TRIP_ID = "00000000-0000-4000-8000-0000000000b1";

const none: FinancialEntryListItem["links"] = {
  activityId: null,
  activityNumber: null,
  workOrderId: null,
  workOrderAssetId: null,
};

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

afterEach(cleanup);

describe("entry links", () => {
  it("opens the work order in its vehicle's workspace", () => {
    render(
      <EntryLinks
        links={{ ...none, workOrderId: WORK_ORDER_ID, workOrderAssetId: ASSET_ID }}
      />,
    );

    const link = screen.getByRole("link", { name: "Work order 3F1A9C40" });
    expect(link.getAttribute("href")).toBe(
      `/assets/${ASSET_ID}/maintenance?panel=work_order%3A${WORK_ORDER_ID}`,
    );
  });

  it("links the trip by its number", () => {
    render(<EntryLinks links={{ ...none, activityId: TRIP_ID, activityNumber: "DLA-2026-00042" }} />);

    const link = screen.getByRole("link", { name: "Trip DLA-2026-00042" });
    expect(link.getAttribute("href")).toBe(`/activities/${TRIP_ID}`);
  });

  it("says it in French by default", async () => {
    await i18n.changeLanguage("fr-CM");
    try {
      render(
        <EntryLinks
          links={{ ...none, workOrderId: WORK_ORDER_ID, workOrderAssetId: ASSET_ID }}
        />,
      );
      expect(screen.getByRole("link", { name: "Ordre de travail 3F1A9C40" })).toBeTruthy();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("renders nothing for an entry that belongs to neither", () => {
    const { container } = render(<EntryLinks links={none} />);
    expect(container.textContent).toBe("");
  });
});
