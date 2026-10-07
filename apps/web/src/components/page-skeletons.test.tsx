// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { i18n } from "../i18n/index.js";
import * as skeletons from "./page-skeletons.js";

afterEach(cleanup);
afterAll(() => i18n.changeLanguage("fr-CM"));

describe.each([
  ["fr-CM", "Chargement…"],
  ["en", "Loading…"],
])("in %s", (language, label) => {
  it.each(Object.entries(skeletons))("%s says it is loading, once", async (_, Skeleton) => {
    await i18n.changeLanguage(language);
    render(
      <I18nextProvider i18n={i18n}>
        <Skeleton />
      </I18nextProvider>,
    );
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.textContent).toBe(label);
  });
});
