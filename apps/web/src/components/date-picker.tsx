import { useState } from "react"
import { useTranslation } from "react-i18next"
import { CalendarDays } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface DatePickerProps {
  /** An ISO calendar date, `YYYY-MM-DD`, or "" for none. */
  value: string
  onChange: (value: string) => void
  id?: string
  "aria-label"?: string
  "aria-describedby"?: string
  "aria-invalid"?: boolean
  /** The last day that may be picked, as an ISO date; later days are greyed out. */
  max?: string
  /** Offers "Clear" under the calendar, for a date that may be left out. */
  clearable?: boolean
  disabled?: boolean
  placeholder?: string
  className?: string
}

function parseIsoDate(value: string | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "")
  if (match === null) return undefined
  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  return Number.isNaN(date.getTime()) ? undefined : date
}

function toIsoDate(date: Date) {
  const year = String(date.getFullYear()).padStart(4, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/**
 * One calendar day, picked from a calendar in a popover — never the browser's
 * native date input, which renders differently on every low-end Android.
 * The value is an ISO date string both ways, so it drops into a payload as is.
 */
function DatePicker({
  value,
  onChange,
  id,
  max,
  clearable = false,
  disabled = false,
  placeholder,
  className,
  ...aria
}: DatePickerProps) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const locale = (i18n.resolvedLanguage ?? i18n.language).startsWith("fr")
    ? "fr"
    : "en"
  const formatter = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", {
    dateStyle: "medium",
  })
  const selected = parseIsoDate(value)
  const last = parseIsoDate(max)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={aria["aria-label"]}
            aria-describedby={aria["aria-describedby"]}
            aria-invalid={aria["aria-invalid"]}
            className={cn(
              "w-full justify-between px-3 font-normal aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
              selected === undefined && "text-muted-foreground",
              className,
            )}
          />
        }
      >
        <span className="truncate">
          {selected === undefined
            ? (placeholder ?? t("datePicker.placeholder"))
            : formatter.format(selected)}
        </span>
        <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          locale={locale}
          {...(selected === undefined ? {} : { selected })}
          {...(last === undefined ? {} : { disabled: (day: Date) => day > last })}
          onSelect={(day) => {
            onChange(toIsoDate(day))
            setOpen(false)
          }}
        />
        {clearable && selected !== undefined && (
          <div className="border-t p-2">
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                onChange("")
                setOpen(false)
              }}
            >
              {t("datePicker.clear")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
