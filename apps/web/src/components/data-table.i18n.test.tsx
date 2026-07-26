// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "../i18n/index.js";
import { DataTable } from "./data-table.js";

type Person = { name: string };

const columns: ColumnDef<Person>[] = [
  { accessorKey: "name", header: "Nom", meta: { mobile: "primary" } },
];

const data: Person[] = [{ name: "Ada Lovelace" }, { name: "Grace Hopper" }];

function renderTable(rows: Person[]) {
  return render(
    <I18nextProvider i18n={i18n}>
      <DataTable columns={columns} data={rows} enableRowSelection />
    </I18nextProvider>,
  );
}

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("fr-CM");
});

describe("DataTable localization", () => {
  it("pluralizes the footer counts in fr-CM", () => {
    renderTable(data);

    expect(screen.getByText("2 lignes chargées")).toBeTruthy();
    expect(screen.getByText("0 ligne sélectionnée")).toBeTruthy();
  });

  it("uses the singular form for a single row", () => {
    renderTable([data[0]!]);

    expect(screen.getByText("1 ligne chargée")).toBeTruthy();
  });

  it("switches to en", async () => {
    await i18n.changeLanguage("en");
    renderTable(data);

    expect(screen.getByText("2 rows loaded")).toBeTruthy();
    expect(screen.getByText("0 rows selected")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Select all" })).toBeTruthy();
  });
});
