import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { i18n } from "@/i18n/index.js";
import { NotRecorded } from "./not-recorded.js";

describe("NotRecorded", () => {
  it("says the value is missing, with no Add for a viewer who may not fill it", async () => {
    await i18n.changeLanguage("en");
    render(<NotRecorded />);
    expect(screen.getByText("Not recorded")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers an inline Add that opens the edit", async () => {
    await i18n.changeLanguage("fr-CM");
    const onAdd = vi.fn();
    render(<NotRecorded onAdd={onAdd} />);
    expect(screen.getByText("Non renseigné")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Ajouter" }));
    expect(onAdd).toHaveBeenCalledOnce();
  });
});
