// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select"

const METHODS = [
  { value: "CASH", label: "Espèces" },
  { value: "MOMO", label: "Mobile Money" },
]

function renderSelect(props: { value?: string | null; placeholder?: string } = {}) {
  return render(
    <Select value={props.value ?? null}>
      <SelectTrigger aria-label="Payment method">
        <SelectValue {...(props.placeholder ? { placeholder: props.placeholder } : {})} />
      </SelectTrigger>
      <SelectContent>
        {METHODS.map((method) => (
          <SelectItem key={method.value} value={method.value}>
            {method.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>,
  )
}

afterEach(cleanup)

describe("Select trigger label", () => {
  it("shows the selected item's label, not its code", () => {
    renderSelect({ value: "CASH" })

    const trigger = screen.getByLabelText("Payment method")
    expect(trigger.textContent).toContain("Espèces")
    expect(trigger.textContent).not.toContain("CASH")
  })

  it("leaves the placeholder alone when nothing is selected", () => {
    renderSelect({ value: null, placeholder: "Choose a method…" })

    const trigger = screen.getByLabelText("Payment method")
    expect(trigger.textContent).toContain("Choose a method…")
    expect(trigger.textContent).not.toContain("Espèces")
  })

  it("reads labels through a group wrapper", () => {
    render(
      <Select value="MOMO">
        <SelectTrigger aria-label="Payment method">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {METHODS.map((method) => (
              <SelectItem key={method.value} value={method.value}>
                {method.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>,
    )

    expect(screen.getByLabelText("Payment method").textContent).toContain(
      "Mobile Money",
    )
  })

  it("defers to an explicit items map when the caller supplies one", () => {
    render(
      <Select value="CASH" items={[{ value: "CASH", label: "Cash on hand" }]}>
        <SelectTrigger aria-label="Payment method">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="CASH">Espèces</SelectItem>
        </SelectContent>
      </Select>,
    )

    expect(screen.getByLabelText("Payment method").textContent).toContain(
      "Cash on hand",
    )
  })
})
