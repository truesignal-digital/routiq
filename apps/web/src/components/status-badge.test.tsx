import { render, screen } from "@testing-library/react";
import { Truck } from "lucide-react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./status-badge.js";

describe("StatusBadge", () => {
  it("renders with neutral tone", () => {
    const { container } = render(
      <StatusBadge tone="neutral">Neutral</StatusBadge>
    );
    expect(container.textContent).toContain("Neutral");
    const span = container.querySelector("span");
    expect(span?.className).toContain("bg-foreground/[0.05]");
    expect(span?.className).toContain("text-muted-foreground");
  });

  it("renders with success tone", () => {
    const { container } = render(
      <StatusBadge tone="success">Success</StatusBadge>
    );
    expect(container.textContent).toContain("Success");
    const span = container.querySelector("span");
    expect(span?.className).toContain("bg-success/10");
    expect(span?.className).toContain("text-success-foreground");
  });

  it("renders with warning tone", () => {
    const { container } = render(
      <StatusBadge tone="warning">Warning</StatusBadge>
    );
    expect(container.textContent).toContain("Warning");
    const span = container.querySelector("span");
    expect(span?.className).toContain("bg-warning/10");
    expect(span?.className).toContain("text-warning-foreground");
  });

  it("renders with info tone", () => {
    const { container } = render(<StatusBadge tone="info">Info</StatusBadge>);
    expect(container.textContent).toContain("Info");
    const span = container.querySelector("span");
    expect(span?.className).toContain("bg-info/10");
    expect(span?.className).toContain("text-info-foreground");
  });

  it("renders with danger tone", () => {
    const { container } = render(
      <StatusBadge tone="danger">Danger</StatusBadge>
    );
    expect(container.textContent).toContain("Danger");
    const span = container.querySelector("span");
    expect(span?.className).toContain("bg-destructive/10");
    expect(span?.className).toContain("text-destructive");
  });

  it("does not use palette classes", () => {
    const { container } = render(
      <StatusBadge tone="warning">Check Colors</StatusBadge>
    );
    const classStr = container.querySelector("span")?.className || "";
    expect(classStr).not.toMatch(/amber-|emerald-|sky-/);
  });

  it("accepts custom className", () => {
    const { container } = render(
      <StatusBadge tone="success" className="custom-class">
        Custom
      </StatusBadge>
    );
    const span = container.querySelector("span");
    expect(span?.className).toContain("custom-class");
  });

  describe("icon slot", () => {
    const toneIcons = [
      ["success", "lucide-circle-check"],
      ["warning", "lucide-clock"],
      ["info", "lucide-loader-circle"],
      ["danger", "lucide-circle-x"],
    ] as const;

    it.each(toneIcons)("gives %s tone its own glyph", (tone, iconClass) => {
      const { container } = render(<StatusBadge tone={tone}>Label</StatusBadge>);

      expect(container.querySelector(`.${iconClass}`)).toBeTruthy();
    });

    it("leaves neutral bare, since the tone says nothing specific", () => {
      const { container } = render(<StatusBadge tone="neutral">Label</StatusBadge>);

      expect(container.querySelector("svg")).toBeNull();
    });

    it("hides the glyph from assistive tech — the label carries the meaning", () => {
      const { container } = render(<StatusBadge tone="success">Posted</StatusBadge>);

      expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      expect(screen.getByText("Posted")).toBeTruthy();
    });

    it("omits the glyph on icon={null}", () => {
      const { container } = render(
        <StatusBadge tone="success" icon={null}>
          Label
        </StatusBadge>
      );

      expect(container.querySelector("svg")).toBeNull();
    });

    it("takes a caller's own icon over the tone default", () => {
      const { container } = render(
        <StatusBadge tone="success" icon={Truck}>
          Label
        </StatusBadge>
      );

      expect(container.querySelector(".lucide-truck")).toBeTruthy();
      expect(container.querySelector(".lucide-circle-check")).toBeNull();
    });
  });
});
