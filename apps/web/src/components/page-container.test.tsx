import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageContainer } from "./page-container";

describe("PageContainer", () => {
  it("renders children inside the container", () => {
    render(
      <PageContainer>
        <div>Test content</div>
      </PageContainer>
    );
    expect(screen.getByText("Test content")).toBeTruthy();
  });

  it("renders with default width (max-w-3xl)", () => {
    const { container } = render(
      <PageContainer>
        <div>Content</div>
      </PageContainer>
    );
    const section = container.querySelector("section");
    expect(section?.classList.contains("max-w-3xl")).toBe(true);
  });

  it("renders with narrow width (max-w-xl)", () => {
    const { container } = render(
      <PageContainer width="narrow">
        <div>Content</div>
      </PageContainer>
    );
    const section = container.querySelector("section");
    expect(section?.classList.contains("max-w-xl")).toBe(true);
  });

  it("renders with wide width (max-w-6xl)", () => {
    const { container } = render(
      <PageContainer width="wide">
        <div>Content</div>
      </PageContainer>
    );
    const section = container.querySelector("section");
    expect(section?.classList.contains("max-w-6xl")).toBe(true);
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

  it("has consistent base classes (mx-auto, w-full, px-4, py-6)", () => {
    const { container } = render(
      <PageContainer>
        <div>Content</div>
      </PageContainer>
    );
    const section = container.querySelector("section");
    expect(section?.classList.contains("mx-auto")).toBe(true);
    expect(section?.classList.contains("w-full")).toBe(true);
    expect(section?.classList.contains("px-4")).toBe(true);
    expect(section?.classList.contains("py-6")).toBe(true);
  });
});
