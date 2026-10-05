import { cn } from "@/lib/utils"

export interface ChipOption<K extends string> {
  key: K
  label: string
  count?: number | undefined
}

/**
 * One choice out of a few, shown as a row of chips above a list. A chip with
 * a count of 0 is disabled unless it is the current choice.
 */
function FilterChips<K extends string>({
  options,
  value,
  onChange,
  label,
  layout = "scroll",
}: {
  options: ReadonlyArray<ChipOption<K>>
  value: K
  onChange: (key: K) => void
  label: string
  /** `scroll` keeps one line that scrolls sideways on phone; `wrap` breaks onto more lines. */
  layout?: "scroll" | "wrap"
}) {
  const group = (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("flex gap-1.5", layout === "scroll" ? "w-max" : "flex-wrap")}
    >
      {options.map((option) => {
        const active = option.key === value
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={option.count === 0 && !active}
            onClick={() => onChange(option.key)}
            className={cn(
              "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors disabled:opacity-40",
              active
                ? "border-foreground/20 bg-muted font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span className="text-xs tabular-nums text-muted-foreground">{option.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )

  if (layout === "wrap") return group

  return (
    <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      {group}
    </div>
  )
}

export { FilterChips }
