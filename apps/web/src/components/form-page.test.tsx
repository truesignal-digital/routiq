// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FormProvider, useForm } from "react-hook-form";
import type { ReactNode } from "react";

import { i18n } from "../i18n/index.js";
import { FormPage, type FormPageProps, type FormPageSection } from "./form-page.js";

interface Values {
  code: string;
  route: string;
  note: string;
}

function sections(register: ReturnType<typeof useForm<Values>>["register"]): FormPageSection[] {
  return [
    {
      id: "identity",
      title: "Identity",
      state: { missing: 0, started: true },
      fields: ["code"],
      children: (
        <div data-field="code">
          <label htmlFor="code">Code</label>
          <input id="code" {...register("code", { required: true })} />
        </div>
      ),
    },
    {
      id: "route",
      title: "Route",
      state: { missing: 2, started: false },
      fields: ["route"],
      children: (
        <div data-field="route">
          <label htmlFor="route">Route field</label>
          <input id="route" {...register("route", { required: true })} />
        </div>
      ),
    },
    {
      id: "notes",
      title: "Notes",
      state: { missing: 0, started: false },
      fields: ["note"],
      children: (
        <div>
          <label htmlFor="note">Note</label>
          <input id="note" {...register("note")} />
        </div>
      ),
    },
  ];
}

function Harness({
  onValid = () => {},
  ...props
}: Partial<FormPageProps> & { onValid?: (values: Values) => void }) {
  const form = useForm<Values>({ defaultValues: { code: "TR-1", route: "", note: "" } });
  return (
    <FormProvider {...form}>
      <FormPage
        title="Record a sheet"
        description="Work down the paper sheet."
        onSubmit={(event) => void form.handleSubmit(onValid)(event)}
        sections={sections(form.register)}
        summary={[
          { label: "Truck", value: "VH001" },
          { label: "Distance", field: "route" },
          { label: "Profit", value: "364 000 FCFA", total: true },
        ]}
        missing={[
          { field: "route", label: "Route field" },
          { field: "missing-elsewhere", label: "Arrival" },
        ]}
        actions={
          <>
            <button type="button">Record and close</button>
            <button type="submit">Record sheet</button>
          </>
        }
        {...props}
      />
    </FormProvider>
  );
}

function renderPage(node: ReactNode) {
  return render(node);
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

const originalScroll = Element.prototype.scrollIntoView;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Element.prototype.scrollIntoView = originalScroll;
});

describe("FormPage on a wide screen", () => {
  it("puts the title and one sentence over titled section cards, each showing its state", () => {
    renderPage(<Harness />);

    expect(screen.getByRole("heading", { level: 1, name: "Record a sheet" })).toBeTruthy();
    expect(screen.getByText("Work down the paper sheet.")).toBeTruthy();
    const card = (title: string) =>
      screen.getByRole("heading", { level: 2, name: title }).closest<HTMLElement>("[data-section]");
    expect(within(card("Identity") as HTMLElement).getByText("Done")).toBeTruthy();
    expect(within(card("Route") as HTMLElement).getByText("2 missing")).toBeTruthy();
    expect(within(card("Notes") as HTMLElement).getByText("Not started")).toBeTruthy();
  });

  it("holds the form to a 760 px column beside a context column", () => {
    const { container } = renderPage(<Harness />);
    const grid = container.querySelector("[data-slot=form-page-column]")?.parentElement;
    expect(grid?.className).toContain("grid-cols-[minmax(0,760px)_300px]");
    expect(screen.getByRole("complementary", { name: "So far" })).toBeTruthy();
  });

  it("sums up what was entered and says what nobody entered", () => {
    renderPage(<Harness />);
    const soFar = screen.getByRole("complementary", { name: "So far" });

    expect(within(soFar).getByText("VH001")).toBeTruthy();
    expect(within(soFar).getByText("364 000 FCFA")).toBeTruthy();
    expect(within(soFar).getByText("Not recorded")).toBeTruthy();
  });

  it("links each missing field and scrolls to it, focused", async () => {
    const user = userEvent.setup();
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    renderPage(<Harness />);

    await user.click(screen.getByRole("button", { name: "Go to Route field" }));

    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Route field")));
    expect(scrolled).toHaveBeenCalled();
  });

  it("lets Add on an unrecorded line take the clerk to its field", async () => {
    const user = userEvent.setup();
    Element.prototype.scrollIntoView = vi.fn();
    renderPage(<Harness />);

    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Route field")));
  });

  it("has one sticky footer: the missing count on the left, the buttons on the right, main button last", () => {
    const { container } = renderPage(<Harness />);
    const footer = container.querySelector<HTMLElement>("[data-slot=form-page-footer]");
    if (footer === null) throw new Error("no footer");

    expect(footer.className).toContain("sticky");
    expect(within(footer).getByText("2 missing")).toBeTruthy();
    const buttons = within(footer).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Record and close", "Record sheet"]);
    expect(buttons.at(-1)?.getAttribute("type")).toBe("submit");
    expect(buttons.some((button) => button.className.includes("flex-1"))).toBe(false);
  });

  it("adds when the draft was saved, when the form keeps one", () => {
    renderPage(<Harness draftSavedAt={new Date(2026, 9, 10, 12, 31)} />);

    expect(screen.getByText("2 missing · draft saved 12:31")).toBeTruthy();
  });

  it("says nothing is missing once every required field is filled", () => {
    renderPage(<Harness missing={[]} />);

    expect(screen.getAllByText("Nothing missing").length).toBeGreaterThan(0);
  });
});

describe("FormPage on a phone", () => {
  function phone() {
    vi.stubGlobal("innerWidth", 390);
  }

  const visibleSections = () =>
    screen
      .getAllByRole("heading", { level: 2 })
      .filter((heading) => heading.closest("[data-section]")?.hasAttribute("hidden") === false)
      .map((heading) => heading.textContent);

  it("shows one section per step, then a review with So far and the buttons", async () => {
    phone();
    const user = userEvent.setup();
    renderPage(<Harness />);

    await waitFor(() => expect(screen.getByText("Step 1 of 4")).toBeTruthy());
    expect(visibleSections()).toEqual(["Identity"]);
    expect(screen.queryByRole("button", { name: "Record sheet" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(visibleSections()).toEqual(["Route"]);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Review")).toBeTruthy();
    expect(screen.getByText("So far")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record sheet" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Change Route" }));
    expect(visibleSections()).toEqual(["Route"]);
  });

  it("moves on with Enter instead of recording before the review", async () => {
    phone();
    const onValid = vi.fn();
    renderPage(<Harness onValid={onValid} />);
    await waitFor(() => expect(screen.getByText("Step 1 of 4")).toBeTruthy());

    fireEvent.submit(screen.getByLabelText("Code").closest("form") as HTMLFormElement);

    await waitFor(() => expect(screen.getByText("Step 2 of 4")).toBeTruthy());
    expect(onValid).not.toHaveBeenCalled();
  });

  it("opens the step holding the first error when the review's submit is refused", async () => {
    phone();
    const user = userEvent.setup();
    const onValid = vi.fn();
    renderPage(<Harness onValid={onValid} />);
    await waitFor(() => expect(screen.getByText("Step 1 of 4")).toBeTruthy());
    for (let step = 0; step < 3; step += 1) await user.click(screen.getByRole("button", { name: "Next" }));

    await user.click(screen.getByRole("button", { name: "Record sheet" }));

    await waitFor(() => expect(visibleSections()).toEqual(["Route"]));
    expect(onValid).not.toHaveBeenCalled();
  });
});
