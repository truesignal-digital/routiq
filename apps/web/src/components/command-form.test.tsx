// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.js";
import { CommandForm, PinnedField, ReasonField, type CommandFormProps, type CommandSurface } from "./command-form.js";
import { Sheet, SheetContent } from "./ui/sheet.js";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

afterEach(cleanup);

type Overrides = Partial<Omit<CommandFormProps, "surface" | "title">>;

function base(overrides: Overrides) {
  return {
    description: "Declare what was done.",
    command: "complete-work-order" as const,
    ready: true,
    submitting: false,
    onSubmit: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
}

const field = (
  <label>
    Summary
    <input name="summary" />
  </label>
);

/** A record panel: the host owns the sheet, the form is one page inside it. */
function inPanel(children: ReactNode) {
  return render(
    <Sheet open>
      <SheetContent>{children}</SheetContent>
    </Sheet>,
  );
}

describe("CommandForm on a record panel page", () => {
  it("names the overlay after the form and leads back to the record", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    inPanel(
      <CommandForm
        surface="panel"
        title="Complete work"
        back={{ label: "WO-00ab12 · Brake pads", onBack }}
        {...base({})}
      >
        {field}
      </CommandForm>,
    );

    const panel = screen.getByRole("dialog", { name: "Complete work" });
    expect(within(panel).getByText("Declare what was done.")).toBeTruthy();
    await user.click(
      within(panel).getByRole("button", { name: "Back to WO-00ab12 · Brake pads" }),
    );
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("submits from the sticky footer, and only once the form is ready", async () => {
    const user = userEvent.setup();
    const props = base({ ready: false });
    const { rerender } = inPanel(
      <CommandForm surface="panel" title="Complete work" {...props}>
        {field}
      </CommandForm>,
    );

    const submit = screen.getByRole("button", { name: "Complete work" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("Summary"), "Pads{Enter}");
    expect(props.onSubmit).not.toHaveBeenCalled();

    rerender(
      <Sheet open>
        <SheetContent>
          <CommandForm surface="panel" title="Complete work" {...props} ready>
            {field}
          </CommandForm>
        </SheetContent>
      </Sheet>,
    );
    await user.click(screen.getByRole("button", { name: "Complete work" }));
    expect(props.onSubmit).toHaveBeenCalledOnce();
  });

  it("keeps an ordinary failure above the untouched fields", () => {
    inPanel(
      <CommandForm
        surface="panel"
        title="Complete work"
        {...base({ error: "PERIOD_LOCKED" })}
      >
        {field}
      </CommandForm>,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByLabelText("Summary")).toBeTruthy();
  });
});

describe("CommandForm outcomes that replace the form", () => {
  it("VERSION_CONFLICT offers a refresh in place of the fields", async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    render(
      <CommandForm
        surface="dialog"
        title="Reject the work order"
        {...base({ error: "VERSION_CONFLICT", onReload })}
      >
        {field}
      </CommandForm>,
    );

    expect(screen.getByRole("alert").textContent).toContain("Modified elsewhere");
    expect(screen.queryByLabelText("Summary")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onReload).toHaveBeenCalledOnce();
  });

  it("APPROVAL_REQUIRED informs rather than alarms, and closes", async () => {
    const user = userEvent.setup();
    const props = base({ error: "APPROVAL_REQUIRED" });
    render(
      <CommandForm surface="sheet" title="Transfer" {...props}>
        {field}
      </CommandForm>,
    );

    expect(screen.getByRole("status").textContent).toContain("Approval required");
    expect(screen.queryByRole("alert")).toBeNull();
    // The sheet's own corner ✕ is also "Close"; this is the footer's.
    const close = screen
      .getAllByRole("button", { name: "Close" })
      .find((button) => button.getAttribute("data-slot") !== "sheet-close");
    await user.click(close!);
    expect(props.onDismiss).toHaveBeenCalled();
  });

  it("uses the host's wording when it names the record", () => {
    render(
      <CommandForm
        surface="dialog"
        title="Assign"
        {...base({
          error: "VERSION_CONFLICT",
          conflict: { title: "Asset changed", body: "Refresh the asset." },
        })}
      >
        {field}
      </CommandForm>,
    );

    expect(screen.getByText("Asset changed")).toBeTruthy();
  });

  it("shows an informative code as a note, not an alert", () => {
    render(
      <CommandForm
        surface="page"
        {...base({
          error: "DOCUMENT_ALREADY_SUPERSEDED",
          informativeCodes: ["DOCUMENT_ALREADY_SUPERSEDED"],
        })}
      >
        {field}
      </CommandForm>,
    );

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("CommandForm in the flow of a page", () => {
  it("renders inline, without an overlay or a cancel it has nowhere to go back to", () => {
    const { container } = render(
      <CommandForm surface="page" hideCancel {...base({})}>
        {field}
      </CommandForm>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container.querySelector("form")).not.toBeNull();
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Complete work",
    ]);
  });
});

const SURFACES: readonly CommandSurface[] = ["dialog", "sheet", "panel", "page"];

function onSurface(surface: CommandSurface, props: Overrides) {
  const form =
    surface === "page" ? (
      <CommandForm surface="page" {...base(props)}>
        {field}
      </CommandForm>
    ) : (
      <CommandForm surface={surface} title="Cancel work order" {...base(props)}>
        {field}
      </CommandForm>
    );
  return surface === "panel" ? inPanel(form) : render(form);
}

/** The footer's buttons, in order, without the overlay's own corner close. */
function footerButtons(): HTMLElement[] {
  const submit = screen
    .getAllByRole("button")
    .find((button) => button.getAttribute("type") === "submit");
  const footer = submit?.parentElement;
  if (footer == null) throw new Error("no footer");
  return within(footer).getAllByRole("button");
}

describe.each(SURFACES)("CommandForm footer on a %s", (surface) => {
  it("puts submit last, after the way out", () => {
    onSurface(surface, {});
    const buttons = footerButtons();
    expect(buttons.map((button) => button.textContent)).toEqual(["Cancel", "Complete work"]);
    expect(buttons.at(-1)?.getAttribute("type")).toBe("submit");
  });

  it("renders a destructive command in the destructive variant, with a dismiss that is not its verb", () => {
    onSurface(surface, { command: "cancel-work-order", tone: "destructive" });
    const [dismiss, submit] = footerButtons();
    expect(submit?.textContent).toBe("Cancel work order");
    expect(submit?.className).toContain("text-destructive");
    expect(dismiss?.textContent).toBe("Keep work order");
  });

  it("keeps the default variant otherwise", () => {
    onSurface(surface, {});
    expect(footerButtons().at(-1)?.className).not.toContain("text-destructive");
  });
});

describe("CommandForm labels", () => {
  it("reads a command's intent words, falling back to the command's", () => {
    render(
      <CommandForm
        surface="page"
        {...base({ command: { command: "record-expense", intent: "fuel" }, submitting: true })}
      >
        {field}
      </CommandForm>,
    );
    // Submitting has no fuel-specific wording: the command's is used.
    expect(screen.getByRole("button", { name: "Recording…" })).toBeTruthy();
  });
});

describe("ReasonField", () => {
  it("is marked required and capped at 500 characters", () => {
    render(<ReasonField id="r" label="Reason" value="" onChange={() => undefined} />);
    const input = screen.getByRole("textbox", { name: /Reason/ });
    expect(input.getAttribute("aria-required")).toBe("true");
    expect(input.getAttribute("maxlength")).toBe("500");
    expect(screen.getByText("*")).toBeTruthy();
  });
});

describe("PinnedField", () => {
  it("shows the fixed value where a picker would be", () => {
    render(<PinnedField label="Vehicle">DLA-T-001 · Actros</PinnedField>);
    expect(screen.getByText("Vehicle")).toBeTruthy();
    expect(screen.getByText("DLA-T-001 · Actros")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
