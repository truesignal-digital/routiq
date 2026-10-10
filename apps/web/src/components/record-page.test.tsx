// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Hourglass } from "lucide-react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.js";
import { RecordCrumbProvider, useRecordCrumbLabel } from "../shell/record-crumb.js";
import { Button } from "./ui/button";
import { Fact, FactsSection, RecordBody, RecordHeader, RecordTabs, recordTabOrder } from "./record-page.js";
import { StatusBlock } from "./status-block.js";

vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: "/finance/entries/e1" } }),
}));

const WIDTH = window.innerWidth;

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});
afterEach(() => {
  cleanup();
  window.innerWidth = WIDTH;
});

function phone() {
  window.innerWidth = 390;
}

function Crumb() {
  return <output data-testid="crumb">{useRecordCrumbLabel("/finance/entries/e1") ?? "none"}</output>;
}

describe("RecordHeader", () => {
  it("titles the page with the record's own name and gives the breadcrumb that name, never Detail", () => {
    render(
      <RecordCrumbProvider>
        <RecordHeader name="DLA-2026-00005" status={<span>Waiting</span>} />
        <Crumb />
      </RecordCrumbProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("DLA-2026-00005");
    expect(screen.getByTestId("crumb").textContent).toBe("DLA-2026-00005");
  });

  it("writes one facts line, skipping the facts nobody has", () => {
    render(<RecordHeader name="T-1" facts={["Expense", null, "Repairs", "", "VH003"]} />);
    const line = document.querySelector('[data-slot="record-facts"]');
    expect(line?.textContent).toBe("Expense·Repairs·VH003");
  });

  it("puts the actions top right, beside the title", () => {
    render(<RecordHeader name="T-1" actions={<Button variant="outline">Edit</Button>} />);
    const actions = document.querySelector('[data-slot="record-actions"]');
    expect(actions).not.toBeNull();
    expect(within(actions as HTMLElement).getByRole("button", { name: "Edit" })).toBeTruthy();
  });
});

describe("RecordTabs", () => {
  it("keeps Overview first and History last, whatever the work tabs", async () => {
    const onSelect = vi.fn();
    render(
      <RecordTabs
        label="Entry sections"
        overview={{ key: "overview", label: "Overview" }}
        work={[
          { key: "receipt", label: "Receipt" },
          { key: "legs", label: "Legs" },
        ]}
        history={{ key: "history", label: "History" }}
        active="overview"
        onSelect={onSelect}
      />,
    );
    const names = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(names).toEqual(["Overview", "Receipt", "Legs", "History"]);
    await userEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(onSelect).toHaveBeenCalledWith("history");
  });

  it("orders the tabs from the shape of its props", () => {
    const order = recordTabOrder({ key: "o", label: "O" }, [{ key: "w", label: "W" }], { key: "h", label: "H" });
    expect(order.map((tab) => tab.key)).toEqual(["o", "w", "h"]);
  });
});

describe("Fact", () => {
  it("reads Not recorded for a missing value, with Add only when the viewer may fill it", async () => {
    const onAdd = vi.fn();
    render(
      <FactsSection title="What">
        <Fact label="Description" value={null} onAdd={onAdd} />
        <Fact label="Supplier" value={null} />
        <Fact label="Category" value="Repairs" />
      </FactsSection>,
    );
    expect(screen.getByRole("heading", { name: "What" })).toBeTruthy();
    expect(screen.getAllByText("Not recorded")).toHaveLength(2);
    const add = screen.getAllByRole("button", { name: "Add" });
    expect(add).toHaveLength(1);
    await userEvent.click(add[0] as HTMLElement);
    expect(onAdd).toHaveBeenCalledOnce();
    expect(screen.getByText("Repairs")).toBeTruthy();
  });
});

describe("RecordBody", () => {
  const body = (overview: boolean) => (
    <RecordBody
      overview={overview}
      tabs={<nav data-testid="tabs" />}
      lead={<section data-testid="money" />}
      context={<section data-testid="linked" />}
    >
      <div data-testid="content" />
    </RecordBody>
  );

  it("puts the context in its own column beside the main one", () => {
    render(body(true));
    const aside = screen.getByRole("complementary", { name: "About this record" });
    expect(aside.className).toContain("xl:sticky");
    expect(within(aside).getByTestId("money")).toBeTruthy();
    expect(within(aside).getByTestId("linked")).toBeTruthy();
    expect(document.querySelector('[data-slot="record-body"]')?.className).toContain(
      "xl:grid-cols-[minmax(0,1fr)_300px]",
    );
  });

  it("on a phone puts the money right after the tabs and the rest after the Overview", () => {
    phone();
    render(body(true));
    const order = [...document.querySelectorAll("[data-testid]")].map((node) => node.getAttribute("data-testid"));
    expect(order).toEqual(["tabs", "money", "content", "linked"]);
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("on a phone leaves the context to the Overview", () => {
    phone();
    render(body(false));
    expect(screen.queryByTestId("money")).toBeNull();
    expect(screen.queryByTestId("linked")).toBeNull();
  });
});

describe("StatusBlock", () => {
  const block = (
    <StatusBlock
      tone="waiting"
      icon={Hourglass}
      lead="Waiting for your approval"
      follow="Finance decides."
      action={<Button>Approve entry</Button>}
    />
  );

  it("says what waits and who acts, with the decision beside the sentence", () => {
    render(block);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Waiting for your approval Finance decides.");
    expect(within(status).getByRole("button", { name: "Approve entry" })).toBeTruthy();
  });

  it("on a phone moves the decision to the bottom action bar", () => {
    phone();
    render(block);
    const bar = screen.getByRole("toolbar", { name: "Decision" });
    expect(within(bar).getByRole("button", { name: "Approve entry" })).toBeTruthy();
    expect(within(screen.getByRole("status")).queryByRole("button")).toBeNull();
  });

  it("keeps the decision in the block when the page's bar holds other actions", () => {
    phone();
    render(
      <StatusBlock tone="critical" icon={Hourglass} lead="Grounded" action={<Button>Release</Button>} phoneAction="inline" />,
    );
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(within(screen.getByRole("status")).getByRole("button", { name: "Release" })).toBeTruthy();
  });
});
