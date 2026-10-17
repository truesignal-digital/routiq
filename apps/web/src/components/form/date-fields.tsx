import { useTranslation } from "react-i18next"

import { DateField as DatePicker, DateTimeField as DateTimePicker } from "@/components/date-field"
import { Button } from "@/components/ui/button"
import { FieldFrame, useKitField, type KitFieldProps } from "./field.js"
import { kitField } from "./form-layout.js"

export interface DateFieldProps extends KitFieldProps {
  /** Earliest value allowed, in the field's own format. */
  min?: string | undefined
  /** Latest value allowed, in the field's own format. */
  max?: string | undefined
}

const pad = (value: number) => String(value).padStart(2, "0")

function isoDay(offsetDays: number): string {
  const day = new Date()
  day.setDate(day.getDate() + offsetDays)
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
}

function nowTime(): string {
  const now = new Date()
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function DayChips({
  value,
  disabled,
  onPick,
}: {
  value: string | undefined
  disabled: boolean | undefined
  onPick: (day: string) => void
}) {
  const { t } = useTranslation()
  const chips = [
    { day: isoDay(0), label: t("dateField.today") },
    { day: isoDay(-1), label: t("dateField.yesterday") },
  ]
  return (
    <div data-slot="date-chips" className="flex gap-2">
      {chips.map((chip) => (
        <Button
          key={chip.day}
          type="button"
          variant={value?.slice(0, 10) === chip.day ? "secondary" : "outline"}
          size="desktop-sm"
          disabled={disabled}
          aria-pressed={value?.slice(0, 10) === chip.day}
          onClick={() => onPick(chip.day)}
        >
          {chip.label}
        </Button>
      ))}
    </div>
  )
}

function DateKitField({ kind, name, label, help, placeholder, disabled, min, max }: DateFieldProps & { kind: "date" | "datetime" }) {
  const { field, frame, describedBy, error } = useKitField(name, help)
  const value = typeof field.value === "string" && field.value !== "" ? field.value : undefined
  const Picker = kind === "date" ? DatePicker : DateTimePicker
  return (
    <FieldFrame label={label} help={help} frame={frame}>
      <Picker
        id={frame.id}
        ref={field.ref}
        name={field.name}
        value={value ?? ""}
        onChange={(next) => field.onChange(next === "" ? undefined : next)}
        onBlur={field.onBlur}
        disabled={disabled ?? false}
        aria-invalid={error !== undefined}
        {...(placeholder === undefined ? {} : { placeholder })}
        {...(min === undefined ? {} : { min })}
        {...(max === undefined ? {} : { max })}
        {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
      />
      <DayChips
        value={value}
        disabled={disabled}
        onPick={(day) => field.onChange(kind === "date" ? day : `${day}T${value?.slice(11, 16) || nowTime()}`)}
      />
    </FieldFrame>
  )
}

/**
 * A calendar day (`YYYY-MM-DD`): typed in the reader's format or picked from
 * the calendar, with Today and Yesterday one tap away. Never a native input.
 */
export const DateField = kitField(function DateField(props: DateFieldProps) {
  return <DateKitField kind="date" {...props} />
}, "date")

/**
 * A day and a time on the operator's clock (`YYYY-MM-DDTHH:mm`); Today and
 * Yesterday keep the time already chosen, or take the time now.
 */
export const DateTimeField = kitField(function DateTimeField(props: DateFieldProps) {
  return <DateKitField kind="datetime" {...props} />
}, "datetime")
