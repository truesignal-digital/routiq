// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { i18n } from "../i18n/index.js";
import { withNodes } from "./parts.js";

afterEach(cleanup);
afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

/** The unbreakable run the link sits in, or the link itself when it has none. */
const runAround = (link: HTMLElement) => link.closest(".whitespace-nowrap");

describe("withNodes (#435)", () => {
  it.each([
    { locale: "fr-CM", sentence: "En attente de l'atelier pour terminer la réparation (059DC371)." },
    { locale: "en", sentence: "Waiting on the workshop to finish the repair (059DC371)." },
  ])("keeps the brackets around a linked reference on its line in $locale", async ({ locale, sentence }) => {
    await i18n.changeLanguage(locale);
    const { container } = render(
      <p>
        {withNodes((slots) => i18n.t("vehicle.status.grounded.inProgress", slots), {
          workOrder: <button type="button">059DC371</button>,
        })}
      </p>,
    );

    expect(container.textContent).toBe(sentence);
    expect(runAround(screen.getByRole("button", { name: "059DC371" }))?.textContent).toBe("(059DC371).");
  });

  it("leaves a link that stands between spaces as it is", async () => {
    await i18n.changeLanguage("en");
    const { container } = render(
      <p>
        {withNodes((slots) => i18n.t("vehicle.status.grounded.noWorkOrder", slots), {
          issue: <button type="button">A1B2C3D4</button>,
        })}
      </p>,
    );

    expect(container.textContent).toBe("Nobody has planned the repair yet: problem A1B2C3D4 has no work order.");
    expect(runAround(screen.getByRole("button", { name: "A1B2C3D4" }))).toBeNull();
  });
});
