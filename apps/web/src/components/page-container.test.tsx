import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageContainer } from "./page-container";

const classes = (el: Element | null) => (el?.className ?? "").split(/\s+/);

describe("PageContainer", () => {
  it("renders children inside the container", () => {
    render(
      <PageContainer>
        <div>Test content</div>
      </PageContainer>
    );
    expect(screen.getByText("Test content")).toBeTruthy();
  });

  // jsdom has no layout, so this pins the classes; the widths themselves are
  // measured in the running app at 1440, 1920 and 390 (#658).
  it("has one width: 1 200 px of content, centred, in 24 px gutters (16 on a phone)", () => {
    const { container } = render(
      <PageContainer>
        <div>Content</div>
      </PageContainer>
    );
    const section = container.querySelector("section");
    expect(section?.hasAttribute("data-page-frame")).toBe(true);
    expect(classes(section)).toEqual(
      expect.arrayContaining(["mx-auto", "w-full", "max-w-[1248px]", "px-4", "sm:px-6", "py-6"]),
    );
    expect(classes(section).filter((name) => name.startsWith("max-w-"))).toEqual(["max-w-[1248px]"]);
  });

  it("applies custom className", () => {
    const { container } = render(
      <PageContainer className="custom-class">
        <div>Content</div>
      </PageContainer>
    );
    const section = container.querySelector("section");
    expect(section?.classList.contains("custom-class")).toBe(true);
  });
});
