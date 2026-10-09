// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { i18n } from "../../i18n/index.js";
import { fakeClient } from "../../test/form-harness.js";
import { useCommandForm } from "../use-command-form.js";
import { DateField, DateTimeField } from "./date-fields.js";
import {
  ChoiceField,
  FileField,
  MoneyField,
  NoteField,
  QuantityField,
  ReadingField,
  TextField,
} from "./fields.js";
import { FormGroup, FormLayout, FormOptional, FormPair, type FormLayoutKind } from "./form-layout.js";
import { PersonField, VehicleField } from "./search-field.js";

vi.mock("../../activities/usePersons.js", () => ({
  usePersons: () => ({ data: { items: [{ id: "p1", displayName: "Sali Ahmadou", defaultRole: null }] } }),
}));
vi.mock("../../assets/useAssetOptions.js", () => ({
  useAssetOptions: () => [{ value: "a1", label: "VH003 · Mercedes Actros" }],
}));

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});
afterEach(cleanup);

function Kit({
  kind = "quick-entry",
  schema,
  defaults = {},
  pinned,
  children,
}: {
  kind?: FormLayoutKind;
  schema: z.ZodType<unknown, Record<string, unknown>>;
  defaults?: Record<string, unknown>;
  pinned?: ReactNode;
  children: ReactNode;
}) {
  const state = useCommandForm(schema, "add-note", 1, {
    defaults: () => defaults,
    success: { namespace: "vehicle", message: "noteAdded" },
    onDismiss: () => undefined,
    client: fakeClient(),
  });
  return (
    <FormLayout kind={kind} form={state} title="Log fuel" description="What it does." hint="Goes to approval." pinned={pinned}>
      {children}
    </FormLayout>
  );
}

function renderKit(props: Parameters<typeof Kit>[0]) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Kit {...props} />
    </QueryClientProvider>,
  );
}

const submit = () => screen.getByRole("button", { name: "Add the note" });
const classOf = (element: Element | null | undefined) => element?.getAttribute("class") ?? "";
const texts = (count: number) => Array.from({ length: count }, (_, index) => `f${index}`);
const textSchema = (names: string[]) => z.object(Object.fromEntries(names.map((name) => [name, z.string().optional()])));

describe("FormLayout measures", () => {
  const groups = (
    <>
      <FormGroup title="What">
        <TextField name="a" label="A" />
        <TextField name="b" label="B" />
      </FormGroup>
      <FormGroup title="When">
        <TextField name="c" label="C" />
        <TextField name="d" label="D" />
      </FormGroup>
    </>
  );
  const schema = textSchema(["a", "b", "c", "d"]);

  it.each(["quick-entry", "record", "line-items"] as const)(
    "%s: a side panel with the 16/18 header, 18 px title, 16/24 px gaps and the sticky 64 px footer",
    (kind) => {
      renderKit({ kind, schema, children: groups });
      const panel = screen.getByRole("dialog", { name: "Log fuel" });
      expect(classOf(panel)).toContain(kind === "line-items" ? "sm:max-w-[560px]" : "sm:max-w-[440px]");
      const title = within(panel).getByText("Log fuel");
      expect(classOf(title)).toContain("text-lg");
      expect(classOf(title.parentElement)).toContain("py-4");
      expect(classOf(title.parentElement)).toContain("pl-[18px]");
      expect(classOf(panel.querySelector("[data-slot=form-layout]"))).toContain("gap-6");
      expect(classOf(panel.querySelector("[data-slot=form-group] > div"))).toContain("gap-4");
      const footer = panel.querySelector("[data-slot=form-footer]");
      expect(classOf(footer)).toContain("min-h-16");
      expect(classOf(footer)).toContain("sticky");
      expect(footer?.firstElementChild?.textContent).toBe("Goes to approval.");
      const buttons = within(footer as HTMLElement).getAllByRole("button");
      expect(buttons.map((button) => button.textContent)).toEqual(["Cancel", "Add the note"]);
    },
  );

  it("decision: a 440 px dialog whose buttons stack on a phone, the verb last", () => {
    renderKit({ kind: "decision", schema: textSchema(["reason"]), children: <NoteField name="reason" label="Reason" /> });
    const dialog = screen.getByRole("dialog", { name: "Log fuel" });
    expect(classOf(dialog)).toContain("sm:max-w-[440px]");
    const footer = dialog.querySelector("[data-slot=dialog-footer]");
    expect(classOf(footer)).toContain("min-h-16");
    const row = within(footer as HTMLElement).getByRole("button", { name: "Add the note" }).parentElement;
    expect(classOf(row)).toContain("flex-col");
    expect(row?.lastElementChild?.textContent).toBe("Add the note");
  });

  it("long capture: a 760 px page column, each group a card with two columns, a sticky footer", () => {
    renderKit({ kind: "long-capture", schema, children: groups });
    const form = document.querySelector("form");
    expect(classOf(form)).toContain("max-w-[760px]");
    const group = document.querySelector("[data-slot=form-group]");
    expect(classOf(group)).toContain("rounded-xl");
    expect(classOf(group?.querySelector("div"))).toContain("md:grid-cols-2");
    expect(classOf(document.querySelector("[data-slot=form-footer]"))).toContain("sticky");
  });

  it("edit in place: the card's fields in two columns, the footer inside the card", () => {
    renderKit({ kind: "edit-in-place", schema, children: groups });
    const form = document.querySelector("form");
    expect(classOf(form)).toContain("rounded-xl");
    expect(classOf(document.querySelector("[data-slot=form-group] > div"))).toContain("sm:grid-cols-2");
    expect(form?.contains(document.querySelector("[data-slot=form-footer]"))).toBe(true);
  });

  it("hides group headings in a form of three fields or fewer", () => {
    renderKit({
      schema: textSchema(["a", "b"]),
      children: (
        <FormGroup title="What">
          <TextField name="a" label="A" />
          <TextField name="b" label="B" />
        </FormGroup>
      ),
    });
    expect(screen.queryByRole("heading", { name: "What" })).toBeNull();
  });

  it("shows group headings once a form has more than three fields", () => {
    renderKit({ schema, children: groups });
    expect(screen.getByRole("heading", { name: "What" })).toBeTruthy();
  });

  it("puts the pinned context above the fields", () => {
    renderKit({ schema: textSchema(["a"]), pinned: <p>VH003</p>, children: <TextField name="a" label="A" /> });
    const pinned = screen.getByText("VH003");
    expect(pinned.compareDocumentPosition(screen.getByLabelText("A")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("FormLayout limits (dev)", () => {
  // React reports the thrown render error too; the assertion is the throw.
  const quiet = () => vi.spyOn(console, "error").mockImplementation(() => undefined);

  it("refuses a Quick entry of more than six fields", () => {
    const spy = quiet();
    const names = texts(7);
    expect(() =>
      renderKit({ schema: textSchema(names), children: names.map((name) => <TextField key={name} name={name} label={name} />) }),
    ).toThrow(/at most 6 fields/);
    spy.mockRestore();
  });

  it("accepts a Quick entry of six fields", () => {
    const names = texts(6);
    renderKit({ schema: textSchema(names), children: names.map((name) => <TextField key={name} name={name} label={name} />) });
    expect(screen.getAllByRole("textbox")).toHaveLength(6);
  });

  it("refuses a Record of more than fourteen fields", () => {
    const spy = quiet();
    const names = texts(15);
    expect(() =>
      renderKit({
        kind: "record",
        schema: textSchema(names),
        children: names.map((name) => <TextField key={name} name={name} label={name} />),
      }),
    ).toThrow(/at most 14 fields/);
    spy.mockRestore();
  });

  it("refuses a Record of more than four groups", () => {
    const spy = quiet();
    const names = texts(5);
    expect(() =>
      renderKit({
        kind: "record",
        schema: textSchema(names),
        children: names.map((name) => (
          <FormGroup key={name} title={name}>
            <TextField name={name} label={name} />
          </FormGroup>
        )),
      }),
    ).toThrow(/at most 4 groups/);
    spy.mockRestore();
  });

  it("refuses a Decision with more than one field", () => {
    const spy = quiet();
    expect(() =>
      renderKit({
        kind: "decision",
        schema: textSchema(["a", "b"]),
        children: (
          <>
            <TextField name="a" label="A" />
            <TextField name="b" label="B" />
          </>
        ),
      }),
    ).toThrow(/at most 1 fields/);
    spy.mockRestore();
  });

  it("refuses a FormPair that is not on the list", () => {
    const spy = quiet();
    expect(() =>
      renderKit({
        schema: z.object({ amount: z.number(), note: z.string() }),
        children: (
          <FormPair pair="amount-date">
            <MoneyField name="amount" label="Amount" />
            <TextField name="note" label="Note" />
          </FormPair>
        ),
      }),
    ).toThrow(/FormPair "amount-date" does not fit \[money, text\]/);
    spy.mockRestore();
  });

  it("puts an allowed pair side by side", () => {
    renderKit({
      schema: z.object({ amount: z.number(), on: z.iso.date() }),
      children: (
        <FormPair pair="amount-date">
          <MoneyField name="amount" label="Amount" />
          <DateField name="on" label="Date" />
        </FormPair>
      ),
    });
    expect(classOf(document.querySelector("[data-slot=form-pair]"))).toContain("min-[400px]:grid-cols-2");
  });
});

describe("FormOptional", () => {
  it("folds the optional fields with their filled count and opens itself on an error", async () => {
    const user = userEvent.setup();
    renderKit({
      schema: z.object({ station: z.string().max(3).optional(), note: z.string().optional() }),
      defaults: { note: "Kept" },
      children: (
        <FormOptional>
          <TextField name="station" label="Station" />
          <NoteField name="note" label="Note" />
        </FormOptional>
      ),
    });
    const fold = screen.getByRole("button", { name: /More details \(optional\)/ });
    // A filled field opens the fold from the start.
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    expect(fold.textContent).toContain("Station, Note");
    expect(fold.textContent).toContain("1 of 2");
    await user.click(fold);
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByLabelText("Station").closest("[hidden]")).toBeTruthy();

    await user.click(fold);
    await user.type(screen.getByLabelText("Station"), "Too long");
    await user.click(fold);
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    await user.click(submit());
    await waitFor(() => expect(fold.getAttribute("aria-expanded")).toBe("true"));
    expect(fold.textContent).toContain("2 of 2");
  });
});

describe("FormLayout focus", () => {
  it("focuses the first empty required field on open", async () => {
    renderKit({
      schema: z.object({ station: z.string().optional(), amount: z.number().positive(), note: z.string().min(1) }),
      defaults: { note: "Filled" },
      children: (
        <>
          <TextField name="station" label="Station" />
          <NoteField name="note" label="Note" />
          <MoneyField name="amount" label="Amount" />
        </>
      ),
    });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Amount")));
  });
});

interface FieldCase {
  name: string;
  required: z.ZodType;
  optional: z.ZodType;
  element: ReactNode;
  /** The element that must be 44 px tall. */
  control: () => HTMLElement;
  /** The class that makes it so. */
  height?: RegExp;
}

const OPTIONS_2 = [
  { value: "DIESEL", label: "Diesel" },
  { value: "PETROL", label: "Petrol" },
];
const OPTIONS_5 = ["CASH", "MOMO", "OM", "BANK", "OTHER"].map((value) => ({ value, label: value }));
const OPTIONS_13 = Array.from({ length: 13 }, (_, index) => ({ value: `c${index}`, label: `Category ${index}` }));
const byLabel = () => screen.getByLabelText("Field");
const H44 = /\b(h-11|min-h-11)\b/;

const FIELDS: FieldCase[] = [
  { name: "TextField", required: z.string().min(1), optional: z.string().optional(), element: <TextField name="v" label="Field" help="Help" />, control: byLabel },
  { name: "NoteField", required: z.string().min(1), optional: z.string().optional(), element: <NoteField name="v" label="Field" help="Help" />, control: byLabel, height: /\bmin-h-16\b/ },
  { name: "MoneyField", required: z.number().positive(), optional: z.number().optional(), element: <MoneyField name="v" label="Field" help="Help" />, control: byLabel },
  { name: "DateField", required: z.iso.date(), optional: z.iso.date().optional(), element: <DateField name="v" label="Field" help="Help" />, control: byLabel },
  { name: "DateTimeField", required: z.iso.datetime({ local: true }), optional: z.iso.datetime({ local: true }).optional(), element: <DateTimeField name="v" label="Field" help="Help" />, control: byLabel },
  {
    name: "ChoiceField (segmented)",
    required: z.enum(["DIESEL", "PETROL"]),
    optional: z.enum(["DIESEL", "PETROL"]).optional(),
    element: <ChoiceField name="v" label="Field" help="Help" options={OPTIONS_2} />,
    control: () => screen.getByText("Diesel").closest("label") as HTMLElement,
  },
  {
    name: "ChoiceField (select)",
    required: z.enum(["CASH", "MOMO", "OM", "BANK", "OTHER"]),
    optional: z.string().optional(),
    element: <ChoiceField name="v" label="Field" help="Help" options={OPTIONS_5} />,
    control: byLabel,
  },
  {
    name: "ChoiceField (search)",
    required: z.string().min(1),
    optional: z.string().optional(),
    element: <ChoiceField name="v" label="Field" help="Help" options={OPTIONS_13} />,
    control: byLabel,
  },
  {
    name: "PersonField",
    required: z.uuid(),
    optional: z.uuid().optional(),
    element: <PersonField name="v" label="Field" help="Help" branchCode="DLA" />,
    control: byLabel,
  },
  {
    name: "VehicleField",
    required: z.uuid(),
    optional: z.uuid().optional(),
    element: <VehicleField name="v" label="Field" help="Help" />,
    control: byLabel,
  },
  {
    name: "FileField",
    required: z.array(z.uuid()).min(1),
    optional: z.array(z.uuid()),
    element: <FileField name="v" label="Field" help="Help" camera />,
    control: () => screen.getByRole("button", { name: "Take a photo" }),
    height: /\bmin-h-28\b/,
  },
  { name: "ReadingField", required: z.number().int(), optional: z.number().int().optional(), element: <ReadingField name="v" label="Field" readingType="ODOMETER" help="Help" />, control: byLabel },
  { name: "QuantityField", required: z.number().int(), optional: z.number().int().optional(), element: <QuantityField name="v" label="Field" unit="L" help="Help" />, control: byLabel },
];

describe.each(FIELDS)("$name", ({ required, optional, element, control, height }) => {
  it("is at least 44 px tall", () => {
    renderKit({ schema: z.object({ v: optional }), children: element });
    expect(classOf(control())).toMatch(height ?? H44);
  });

  it("shows the red asterisk when the schema requires it, and only then", () => {
    renderKit({ schema: z.object({ v: required }), children: element });
    const marker = document.querySelector("[data-slot=kit-required]");
    expect(marker?.textContent).toBe("*");
    expect(classOf(marker)).toContain("text-destructive");
    cleanup();
    renderKit({ schema: z.object({ v: optional }), children: element });
    expect(document.querySelector("[data-slot=kit-required]")).toBeNull();
  });

  it("puts the error under the help, keeping the help", async () => {
    const user = userEvent.setup();
    renderKit({ schema: z.object({ v: required }), children: element });
    await user.click(submit());
    const error = await waitFor(() => {
      const found = document.querySelector("[data-slot=kit-error]");
      expect(found).toBeTruthy();
      return found as Element;
    });
    const help = document.querySelector("[data-slot=kit-help]") as Element;
    expect(help.textContent).toBe("Help");
    expect(help.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(classOf(error)).toContain("text-xs");
  });
});

describe("ReadingField", () => {
  it("shows the unit and the last reading", () => {
    renderKit({
      schema: z.object({ v: z.number().optional() }),
      children: <ReadingField name="v" label="Reading" readingType="ODOMETER" last={231_940} />,
    });
    expect(screen.getByText("km")).toBeTruthy();
    expect(screen.getByText("Last reading: 231,940 km")).toBeTruthy();
  });
});

describe("DateField", () => {
  it("fills today from its chip", async () => {
    const user = userEvent.setup();
    renderKit({ schema: z.object({ v: z.iso.date().optional() }), children: <DateField name="v" label="Date" /> });
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByRole("button", { name: "Today" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).not.toBe("");
  });
});

describe("PersonField", () => {
  it("finds a person by typing part of the name, and offers to register a new one", async () => {
    const user = userEvent.setup();
    renderKit({
      schema: z.object({ v: z.string().optional() }),
      children: <PersonField name="v" label="Driver" branchCode="DLA" />,
    });
    await user.click(screen.getByLabelText("Driver"));
    expect(screen.getByRole("button", { name: "Add a person" })).toBeTruthy();
    await user.type(screen.getByRole("searchbox"), "zz");
    expect(screen.getByText("Nothing matches")).toBeTruthy();
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "sali");
    await user.click(screen.getByRole("option", { name: "Sali Ahmadou" }));
    expect(screen.getByLabelText("Driver").textContent).toContain("Sali Ahmadou");
  });
});

describe("ChoiceField", () => {
  it("picks one of a few options from the segmented row", async () => {
    const user = userEvent.setup();
    renderKit({
      schema: z.object({ v: z.enum(["DIESEL", "PETROL"]) }),
      children: <ChoiceField name="v" label="Fuel" options={OPTIONS_2} />,
    });
    await user.click(screen.getByText("Petrol"));
    expect((screen.getByRole("radio", { name: "Petrol" }) as HTMLInputElement).checked).toBe(true);
  });
});
