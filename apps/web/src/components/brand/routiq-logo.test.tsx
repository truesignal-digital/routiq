// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { i18n } from "../../i18n/index.js";
import { PoweredByRoutiq, RoutiqLogo } from "./routiq-logo";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});
afterEach(cleanup);

describe("PoweredByRoutiq", () => {
  it("renders nothing while the header shows the ROUTIQ logo itself", () => {
    const { container } = render(<PoweredByRoutiq companyLogo={undefined} />);
    expect(container.innerHTML).toBe("");
  });

  it("credits ROUTIQ once a company logo fills the header", () => {
    const { container } = render(<PoweredByRoutiq companyLogo="/logos/transports-ngwa.svg" />);
    expect(screen.getByText("powered by ROUTIQ")).toBeTruthy();
    expect(container.querySelector("[data-slot=routiq-mark]")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("RoutiqLogo", () => {
  it("names the mark only when asked, for the collapsed rail", () => {
    render(<RoutiqLogo />);
    expect(screen.queryByRole("img")).toBeNull();
    cleanup();

    render(<RoutiqLogo markTitle="ROUTIQ logo" />);
    expect(screen.getByRole("img", { name: "ROUTIQ logo" })).toBeTruthy();
  });

  it("gives each mark on a page its own mask ids", () => {
    const { container } = render(
      <>
        <RoutiqLogo />
        <RoutiqLogo />
      </>,
    );
    const ids = [...container.querySelectorAll("mask")].map((mask) => mask.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
