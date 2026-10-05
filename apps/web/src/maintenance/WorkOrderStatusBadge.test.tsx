// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { WorkOrderStatus } from "@routiq/contracts";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { i18n } from "../i18n/index.js";
import { isActiveWorkOrder } from "./status.js";
import { WorkOrderStatusBadge, workOrderStatusTone } from "./WorkOrderStatusBadge.js";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

afterEach(cleanup);

describe("WorkOrderStatusBadge", () => {
  const cases = [
    ["SUBMITTED", "warning", "bg-warning/10", "lucide-clock", "Submitted"],
    ["APPROVED", "info", "bg-info/10", "lucide-hourglass", "Approved"],
    ["COMPLETION_SUBMITTED", "warning", "bg-warning/10", "lucide-clock", "Completion submitted"],
    ["COMPLETED", "success", "bg-success/10", "lucide-circle-check", "Completed"],
    ["REJECTED", "danger", "bg-destructive/10", "lucide-circle-x", "Rejected"],
    ["CANCELLED", "neutral", "bg-foreground/[0.05]", "lucide-ban", "Cancelled"],
  ] as const satisfies readonly (readonly [WorkOrderStatus, string, string, string, string])[];

  it.each(cases)("shows %s with its one tone, glyph and label", (status, toneName, tone, icon, label) => {
    const { container } = render(<WorkOrderStatusBadge status={status} />);
    const badge = container.firstElementChild;

    expect(workOrderStatusTone(status)).toBe(toneName);
    expect(badge?.className).toContain(tone);
    expect(badge?.querySelector(`.${icon}`)).toBeTruthy();
    expect(badge?.textContent).toBe(label);
  });

  it("counts only the statuses still moving through the flow as active", () => {
    expect(cases.filter(([status]) => isActiveWorkOrder(status)).map(([status]) => status)).toEqual([
      "SUBMITTED",
      "APPROVED",
      "COMPLETION_SUBMITTED",
    ]);
  });
});
