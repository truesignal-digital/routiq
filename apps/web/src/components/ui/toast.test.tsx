// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { i18n } from "../../i18n/index.js";
import { notifyCommandSuccess } from "../../lib/notify.js";
import { Toaster } from "./toast.js";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

afterEach(cleanup);

describe("toast surface", () => {
  it("shows a notify title and its warning lines in the mounted viewport", async () => {
    render(<Toaster />);

    act(() => {
      notifyCommandSuccess("finance", "approved", ["LATE_POSTING"]);
    });

    await waitFor(() => expect(screen.getByText("Entry approved")).toBeDefined());
    expect(
      screen.getByText(
        "This entry was posted to a previous accounting period.",
      ),
    ).toBeDefined();
  });

  it("localizes the dismiss control rather than shipping English", async () => {
    render(<Toaster />);

    act(() => {
      notifyCommandSuccess("assets", "registered");
    });

    await waitFor(() => expect(screen.getByText("Asset registered")).toBeDefined());
    // Base UI keeps the control out of the a11y tree until the toast is focused,
    // so the label has to be read off the element rather than queried by role.
    const closeLabel = () =>
      document
        .querySelector<HTMLElement>('[data-slot="toast-close"]')
        ?.getAttribute("aria-label");

    expect(closeLabel()).toBe("Close");

    // The label comes from the catalog, not the vendored file's English.
    await i18n.changeLanguage("fr-CM");
    await waitFor(() => expect(closeLabel()).toBe(i18n.t("common.close")));
    expect(closeLabel()).not.toBe("Close");
    await i18n.changeLanguage("en");
  });

  it("anchors the viewport bottom-right", () => {
    render(<Toaster />);

    act(() => {
      notifyCommandSuccess("finance", "locked");
    });

    const viewport = document.querySelector<HTMLElement>(
      '[data-slot="toast-viewport"]',
    );
    expect(viewport).not.toBeNull();
    expect(viewport!.className).toContain("bottom-4");
    expect(viewport!.className).toContain("sm:right-4");
    expect(viewport!.className).toContain("sm:left-auto");
  });
});
