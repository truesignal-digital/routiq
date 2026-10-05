"use client"

import * as React from "react"
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"

import { cn } from "@/lib/utils"

export interface CalendarDateRange {
  from?: Date
  to?: Date
}

interface CalendarBaseProps
  extends Omit<React.ComponentProps<"div">, "onSelect"> {
  locale?: "en" | "fr"
  defaultMonth?: Date
  /** Days that cannot be picked, such as those after today. */
  disabled?: (date: Date) => boolean
}

interface CalendarRangeProps extends CalendarBaseProps {
  mode: "range"
  selected?: CalendarDateRange
  onSelect?: (range: CalendarDateRange | undefined) => void
}

interface CalendarSingleProps extends CalendarBaseProps {
  mode: "single"
  selected?: Date
  onSelect?: (date: Date) => void
}

type CalendarProps = CalendarRangeProps | CalendarSingleProps

const DAYS_IN_GRID = 42

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function sameDay(left: Date | undefined, right: Date) {
  return left !== undefined && startOfDay(left).getTime() === startOfDay(right).getTime()
}

function isBetween(date: Date, from: Date | undefined, to: Date | undefined) {
  if (from === undefined || to === undefined) return false
  const time = startOfDay(date).getTime()
  return time > startOfDay(from).getTime() && time < startOfDay(to).getTime()
}

function Calendar(calendarProps: CalendarProps) {
  const {
    className,
    locale = "en",
    defaultMonth,
    disabled,
    mode: _mode,
    selected: _selected,
    onSelect: _onSelect,
    ...props
  } = calendarProps
  // One shape for the grid: a single day is a range that starts and ends on it.
  const selected: CalendarDateRange | undefined =
    calendarProps.mode === "single"
      ? calendarProps.selected === undefined
        ? undefined
        : { from: calendarProps.selected, to: calendarProps.selected }
      : calendarProps.selected
  const [month, setMonth] = React.useState(() => {
    const shown = defaultMonth ?? selected?.from ?? new Date()
    return new Date(shown.getFullYear(), shown.getMonth(), 1)
  })
  const intlLocale = locale === "fr" ? "fr-FR" : "en-US"
  const weekStartsOn = locale === "fr" ? 1 : 0
  const monthLabel = new Intl.DateTimeFormat(intlLocale, {
    month: "long",
    year: "numeric",
  }).format(month)
  const fullDateFormatter = new Intl.DateTimeFormat(intlLocale, {
    dateStyle: "full",
  })
  const weekdayFormatter = new Intl.DateTimeFormat(intlLocale, {
    weekday: "narrow",
  })
  const firstDayOffset = (month.getDay() - weekStartsOn + 7) % 7
  const firstGridDate = new Date(month.getFullYear(), month.getMonth(), 1 - firstDayOffset)
  const days = Array.from({ length: DAYS_IN_GRID }, (_, index) => {
    return new Date(
      firstGridDate.getFullYear(),
      firstGridDate.getMonth(),
      firstGridDate.getDate() + index,
    )
  })
  const weekdays = Array.from({ length: 7 }, (_, index) => {
    const sunday = new Date(2024, 0, 7)
    sunday.setDate(sunday.getDate() + weekStartsOn + index)
    return weekdayFormatter.format(sunday)
  })

  function selectDay(day: Date) {
    const normalized = startOfDay(day)
    if (calendarProps.mode === "single") {
      calendarProps.onSelect?.(normalized)
      return
    }
    const onSelect = calendarProps.onSelect
    if (selected?.from === undefined || selected.to !== undefined) {
      onSelect?.({ from: normalized })
      return
    }

    if (normalized < startOfDay(selected.from)) {
      onSelect?.({ from: normalized, to: startOfDay(selected.from) })
      return
    }

    onSelect?.({ from: startOfDay(selected.from), to: normalized })
  }

  const shiftMonths = (delta: number) =>
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1))
  const navClass =
    "inline-flex size-11 items-center justify-center rounded-lg outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 desktop:size-8"

  return (
    <div
      data-slot="calendar"
      className={cn("w-fit bg-background p-3", className)}
      {...props}
    >
      <div className="mb-3 flex items-center justify-between gap-1">
        <div className="flex">
          {calendarProps.mode === "single" && (
            // A purchase date can be years back: a year at a time, not 60 clicks.
            <ButtonPrimitive
              type="button"
              aria-label={locale === "fr" ? "Année précédente" : "Previous year"}
              className={navClass}
              onClick={() => shiftMonths(-12)}
            >
              <ChevronsLeft className="size-4" aria-hidden />
            </ButtonPrimitive>
          )}
          <ButtonPrimitive
            type="button"
            aria-label={locale === "fr" ? "Mois précédent" : "Previous month"}
            className={navClass}
            onClick={() => shiftMonths(-1)}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </ButtonPrimitive>
        </div>
        <p className="text-sm font-medium capitalize" aria-live="polite">
          {monthLabel}
        </p>
        <div className="flex">
          <ButtonPrimitive
            type="button"
            aria-label={locale === "fr" ? "Mois suivant" : "Next month"}
            className={navClass}
            onClick={() => shiftMonths(1)}
          >
            <ChevronRight className="size-4" aria-hidden />
          </ButtonPrimitive>
          {calendarProps.mode === "single" && (
            <ButtonPrimitive
              type="button"
              aria-label={locale === "fr" ? "Année suivante" : "Next year"}
              className={navClass}
              onClick={() => shiftMonths(12)}
            >
              <ChevronsRight className="size-4" aria-hidden />
            </ButtonPrimitive>
          )}
        </div>
      </div>

      <div role="grid" aria-label={monthLabel} className="grid grid-cols-7">
        {weekdays.map((weekday, index) => (
          <div
            key={`${weekday}-${index}`}
            role="columnheader"
            className="flex h-8 items-center justify-center text-xs font-normal text-muted-foreground"
          >
            {weekday}
          </div>
        ))}

        {days.map((day) => {
          const rangeStart = sameDay(selected?.from, day)
          const rangeEnd = sameDay(selected?.to, day)
          const rangeMiddle = isBetween(day, selected?.from, selected?.to)
          const outside = day.getMonth() !== month.getMonth()
          const unavailable = disabled?.(day) ?? false

          return (
            <div
              key={`${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`}
              role="gridcell"
              data-selected={rangeStart || rangeEnd || rangeMiddle}
              className={cn(
                "relative flex size-11 items-center justify-center desktop:size-8",
                rangeMiddle && "bg-muted",
                rangeStart && "rounded-s-lg bg-primary",
                rangeEnd && "rounded-e-lg bg-primary",
              )}
            >
              <ButtonPrimitive
                type="button"
                aria-label={fullDateFormatter.format(day)}
                aria-pressed={rangeStart || rangeEnd || rangeMiddle}
                disabled={unavailable}
                data-range-start={rangeStart || undefined}
                data-range-end={rangeEnd || undefined}
                data-range-middle={rangeMiddle || undefined}
                className={cn(
                  "relative z-10 inline-flex size-11 items-center justify-center rounded-lg text-sm desktop:size-8 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                  outside && "text-muted-foreground opacity-50",
                  unavailable && "pointer-events-none text-muted-foreground opacity-40",
                  rangeMiddle && "rounded-none",
                  (rangeStart || rangeEnd) &&
                    "bg-primary text-primary-foreground hover:bg-primary/80",
                )}
                onClick={() => selectDay(day)}
              >
                {day.getDate()}
              </ButtonPrimitive>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export { Calendar }
