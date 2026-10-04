// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.js";
import { DateField, DateTimeField } from "./date-field.js";

type Props = { initial?: string; min?: string; max?: string };

function renderField(kind: "date" | "datetime", { initial = "", min, max }: Props = {}) {
  const changes: string[] = [];
  function Harness() {
    const [value, setValue] = useState(initial);
    const Field = kind === "date" ? DateField : DateTimeField;
    return (
      <>
        <label htmlFor="when">When</label>
        <Field
          id="when"
          value={value}
          {...(min === undefined ? {} : { min })}
          {...(max === undefined ? {} : { max })}
          onChange={(next) => {
            changes.push(next);
            setValue(next);
          }}
        />
        <output data-testid="value">{value}</output>
      </>
    );
  }
  render(
    <I18nextProvider i18n={i18n}>
      <Harness />
    </I18nextProvider>,
  );
  return {
    input: screen.getByLabelText("When") as HTMLInputElement,
    value: () => screen.getByTestId("value").textContent,
    changes,
  };
}

async function openCalendar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: i18n.t("dateField.openCalendar") }));
  return screen.findByRole("dialog");
}

beforeEach(async () => {
  await i18n.changeLanguage("fr-CM");
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await i18n.changeLanguage("fr-CM");
});

describe("DateField", () => {
  it("reads a date typed the French way and hands out an ISO date", async () => {
    const user = userEvent.setup();
    const field = renderField("date");

    await user.type(field.input, "28/07/2026");
    expect(field.value()).toBe("2026-07-28");
    await user.tab();
    expect(field.input.value).toBe("28/07/2026");
  });

  it("reads a date typed the English way, month first", async () => {
    await i18n.changeLanguage("en");
    const user = userEvent.setup();
    const field = renderField("date");

    await user.type(field.input, "07/28/2026");
    expect(field.value()).toBe("2026-07-28");
  });

  it("accepts an ISO date as typed or pasted", async () => {
    const user = userEvent.setup();
    const field = renderField("date");

    await user.type(field.input, "2027-09-19");
    expect(field.value()).toBe("2027-09-19");
    await user.tab();
    expect(field.input.value).toBe("19/09/2027");
  });

  it("shows the stored ISO date in the reader's language", async () => {
    renderField("date", { initial: "2026-10-04" });
    expect((screen.getByLabelText("When") as HTMLInputElement).value).toBe("04/10/2026");
    cleanup();

    await i18n.changeLanguage("en");
    renderField("date", { initial: "2026-10-04" });
    expect((screen.getByLabelText("When") as HTMLInputElement).value).toBe("10/04/2026");
  });

  it("flags a day that does not exist and hands out nothing", async () => {
    const user = userEvent.setup();
    const field = renderField("date", { initial: "2026-02-01" });

    await user.clear(field.input);
    await user.type(field.input, "31/02/2026");
    await user.tab();
    expect(field.value()).toBe("");
    expect(field.input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/^Date non reconnue/)).toBeTruthy();
  });

  it("clears to an empty value when the text is erased", async () => {
    const user = userEvent.setup();
    const field = renderField("date", { initial: "2026-07-28" });

    await user.clear(field.input);
    expect(field.value()).toBe("");
    expect(field.changes.at(-1)).toBe("");
  });

  it("fills today and yesterday from the shortcuts", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 4, 13, 7));
    const user = userEvent.setup();
    const field = renderField("date");

    let popup = await openCalendar(user);
    await user.click(within(popup).getByRole("button", { name: "Aujourd'hui" }));
    expect(field.value()).toBe("2026-10-04");
    expect(field.input.value).toBe("04/10/2026");

    popup = await openCalendar(user);
    await user.click(within(popup).getByRole("button", { name: "Hier" }));
    expect(field.value()).toBe("2026-10-03");
  });

  it("picks a day from the calendar", async () => {
    const user = userEvent.setup();
    const field = renderField("date", { initial: "2026-07-01" });

    const popup = await openCalendar(user);
    await user.click(within(popup).getByRole("button", { name: "mardi 28 juillet 2026" }));
    expect(field.value()).toBe("2026-07-28");
  });

  it("keeps days after max out of reach", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 4, 13, 7));
    const user = userEvent.setup();
    const field = renderField("date", { max: "2026-10-03" });

    const popup = await openCalendar(user);
    expect((within(popup).getByRole("button", { name: "Aujourd'hui" }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      (within(popup).getByRole("button", { name: "dimanche 4 octobre 2026" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.keyboard("{Escape}");

    await user.type(field.input, "04/10/2026");
    await user.tab();
    expect(field.value()).toBe("");
    expect(field.input.getAttribute("aria-invalid")).toBe("true");
  });

  it("keeps days before min out of reach", async () => {
    const user = userEvent.setup();
    const field = renderField("date", { min: "2026-07-10" });

    await user.type(field.input, "09/07/2026");
    expect(field.value()).toBe("");
    await user.clear(field.input);
    await user.type(field.input, "10/07/2026");
    expect(field.value()).toBe("2026-07-10");
  });
});

describe("DateTimeField", () => {
  it("reads a date and a 24-hour time typed the French way", async () => {
    const user = userEvent.setup();
    const field = renderField("datetime");

    await user.type(field.input, "28/07/2026 14:30");
    expect(field.value()).toBe("2026-07-28T14:30");
    await user.tab();
    expect(field.input.value).toBe("28/07/2026 14:30");
  });

  it("reads 13h07 the way it is written in French", async () => {
    const user = userEvent.setup();
    const field = renderField("datetime");

    await user.type(field.input, "04/10/2026 13h07");
    expect(field.value()).toBe("2026-10-04T13:07");
  });

  it("reads an English date with a 12-hour time", async () => {
    await i18n.changeLanguage("en");
    const user = userEvent.setup();
    const field = renderField("datetime");

    await user.type(field.input, "07/28/2026 2:30 PM");
    expect(field.value()).toBe("2026-07-28T14:30");
    await user.tab();
    expect(field.input.value).toBe("07/28/2026 02:30 PM");
  });

  it("accepts the ISO wall clock a datetime-local input produced", () => {
    const field = renderField("datetime");

    fireEvent.change(field.input, { target: { value: "2026-09-25T07:40" } });
    expect(field.value()).toBe("2026-09-25T07:40");
  });

  it("shows the stored wall clock in the reader's language", async () => {
    renderField("datetime", { initial: "2026-10-04T13:07" });
    expect((screen.getByLabelText("When") as HTMLInputElement).value).toBe("04/10/2026 13:07");
    cleanup();

    await i18n.changeLanguage("en");
    renderField("datetime", { initial: "2026-10-04T13:07" });
    expect((screen.getByLabelText("When") as HTMLInputElement).value).toBe("10/04/2026 01:07 PM");
  });

  it("wants a time as well as a date", async () => {
    const user = userEvent.setup();
    const field = renderField("datetime");

    await user.type(field.input, "28/07/2026");
    await user.tab();
    expect(field.value()).toBe("");
    expect(field.input.getAttribute("aria-invalid")).toBe("true");
  });

  it("moves the day from the shortcuts and keeps the time already set", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 4, 13, 7));
    const user = userEvent.setup();
    const field = renderField("datetime", { initial: "2026-09-30T08:15" });

    const popup = await openCalendar(user);
    await user.click(within(popup).getByRole("button", { name: "Hier" }));
    expect(field.value()).toBe("2026-10-03T08:15");
    await user.click(within(popup).getByRole("button", { name: "Aujourd'hui" }));
    expect(field.value()).toBe("2026-10-04T08:15");
  });

  it("starts from the current time when nothing was set", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 4, 13, 7));
    const user = userEvent.setup();
    const field = renderField("datetime");

    const popup = await openCalendar(user);
    await user.click(within(popup).getByRole("button", { name: "Aujourd'hui" }));
    expect(field.value()).toBe("2026-10-04T13:07");
  });

  it("sets the time from the calendar's time box", async () => {
    const user = userEvent.setup();
    const field = renderField("datetime", { initial: "2026-07-28T10:00" });

    const popup = await openCalendar(user);
    await user.click(within(popup).getByRole("button", { name: "mercredi 29 juillet 2026" }));
    expect(field.value()).toBe("2026-07-29T10:00");
    const time = within(popup).getByLabelText("Heure");
    await user.clear(time);
    await user.type(time, "1745");
    expect(field.value()).toBe("2026-07-29T17:45");
    await user.click(within(popup).getByRole("button", { name: "OK" }));
    expect(field.input.value).toBe("29/07/2026 17:45");
  });
});
