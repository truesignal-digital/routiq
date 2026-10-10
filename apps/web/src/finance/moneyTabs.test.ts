import { describe, expect, it } from "vitest";
import type { Role } from "@routiq/contracts";
import { activeMoneyTab, visibleMoneyTabs } from "./moneyTabs.js";

const FINANCE = ["FINANCE"] as const;

describe("Money tabs (#664)", () => {
  it("reads the tab from the address, with the record panel over Entries", () => {
    expect(activeMoneyTab("/finance")).toBe("overview");
    expect(activeMoneyTab("/finance/")).toBe("overview");
    expect(activeMoneyTab("/finance/entries")).toBe("entries");
    expect(activeMoneyTab("/finance/record")).toBe("entries");
    expect(activeMoneyTab("/finance/approve")).toBe("approve");
  });

  it.each<[Role, string[]]>([
    ["DIRECTOR", ["overview", "entries", "approve"]],
    ["FINANCE", ["overview", "entries", "approve"]],
    ["ADMIN", ["overview", "entries"]],
    ["CASHIER", ["overview", "entries"]],
    ["DRIVER", ["entries"]],
    ["TECHNICIAN", []],
  ])("shows %s only the tabs it can use", (role, tabs) => {
    expect(visibleMoneyTabs(role, FINANCE)).toEqual(tabs);
  });

  it("shows nothing with the Finance module off", () => {
    expect(visibleMoneyTabs("DIRECTOR", [])).toEqual([]);
  });
});
