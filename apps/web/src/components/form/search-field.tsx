import { useMemo, useState, type Ref } from "react"
import { ChevronsUpDown, Plus } from "lucide-react"
import { useTranslation } from "react-i18next"

import { useCommandLabel } from "@/commands/labels.js"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { RegisterPersonDialog } from "../../activities/RegisterPersonDialog.js"
import { usePersons } from "../../activities/usePersons.js"
import { useAssetOptions } from "../../assets/useAssetOptions.js"
import { ALL_BRANCHES } from "../../shell/branch-context.js"
import { FieldFrame, useKitField, type KitFieldProps } from "./field.js"
import { kitField } from "./form-layout.js"

export interface SearchOption {
  value: string
  label: string
  /** A second word to tell two alike apart: a role, a plate. */
  detail?: string | undefined
}

/**
 * Pick one of many by typing part of its name. The list is what the client
 * already holds (a branch's people, a fleet), filtered as you type rather
 * than a request per keystroke on an intermittent link. "Register new" sits at
 * the end, so a missing person or vehicle does not mean leaving the form.
 */
export function SearchControl({
  id,
  triggerRef,
  options,
  value,
  onChange,
  onBlur,
  placeholder,
  disabled,
  required,
  invalid,
  describedBy,
  registerNew,
}: {
  id: string
  triggerRef: Ref<HTMLButtonElement>
  options: readonly SearchOption[]
  value: string | undefined
  onChange: (value: string | undefined) => void
  onBlur: () => void
  placeholder?: string | undefined
  disabled?: boolean | undefined
  required: boolean
  invalid: boolean
  describedBy: string | undefined
  registerNew?: { label: string; onSelect: () => void } | undefined
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const selected = options.find((option) => option.value === value)
  const matches = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    if (needle === "") return options
    return options.filter((option) =>
      `${option.label} ${option.detail ?? ""}`.toLocaleLowerCase().includes(needle),
    )
  }, [options, search])

  function pick(next: string) {
    onChange(next)
    setSearch("")
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setSearch("")
          onBlur()
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            ref={triggerRef}
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-haspopup="listbox"
            disabled={disabled ?? false}
            aria-required={required || undefined}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className={cn("w-full justify-between font-normal", selected === undefined && "text-muted-foreground")}
          />
        }
      >
        <span className="truncate">{selected?.label ?? placeholder ?? t("form.search.placeholder")}</span>
        <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-64 gap-1 p-1">
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("form.search.placeholder")}
          aria-label={t("form.search.placeholder")}
        />
        {matches.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">{t("form.search.empty")}</p>
        ) : (
          <ul role="listbox" className="max-h-64 overflow-y-auto">
            {matches.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  onClick={() => pick(option.value)}
                  className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-sm hover:bg-muted aria-selected:bg-muted"
                >
                  <span className="truncate">{option.label}</span>
                  {option.detail !== undefined && (
                    <span className="shrink-0 text-xs text-muted-foreground">{option.detail}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {registerNew !== undefined && (
          <Button
            type="button"
            variant="ghost"
            className="justify-start border-t"
            onClick={() => {
              setOpen(false)
              registerNew.onSelect()
            }}
          >
            <Plus className="size-4" aria-hidden />
            {registerNew.label}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

export interface PersonFieldProps extends KitFieldProps {
  /** The branch a person registered from here belongs to. */
  branchCode: string
  /** Narrows the list; omit for everyone in scope. */
  branchId?: string | undefined
}

/** A driver or any person on file, found by name or code; a new one is registered in place and comes back selected. */
export const PersonField = kitField(function PersonField({
  name,
  label,
  help,
  placeholder,
  disabled,
  branchCode,
  branchId,
}: PersonFieldProps) {
  const { t } = useTranslation()
  const commandLabel = useCommandLabel()
  const { field, frame, describedBy, required, error } = useKitField(name, help)
  const [registering, setRegistering] = useState(false)
  const persons = usePersons({ active: true, ...(branchId === undefined ? {} : { branchId }) })
  const options = useMemo(
    () =>
      (persons.data?.items ?? []).map((person) => ({
        value: person.id,
        label: person.displayName,
        detail: person.defaultRole === null ? undefined : t(`persons.roles.${person.defaultRole}`),
      })),
    [persons.data, t],
  )
  return (
    <FieldFrame label={label} help={help} frame={frame}>
      <SearchControl
        id={frame.id}
        triggerRef={field.ref}
        options={options}
        value={typeof field.value === "string" ? field.value : undefined}
        onChange={field.onChange}
        onBlur={field.onBlur}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        invalid={error !== undefined}
        describedBy={describedBy}
        registerNew={{ label: commandLabel("register-person"), onSelect: () => setRegistering(true) }}
      />
      <RegisterPersonDialog
        open={registering}
        onOpenChange={setRegistering}
        branchCode={branchCode}
        onRegistered={(personId) => field.onChange(personId)}
      />
    </FieldFrame>
  )
}, "person")

export interface VehicleFieldProps extends KitFieldProps {
  /** Registering a vehicle is a page of its own; the host says where it goes. */
  onRegisterNew?: (() => void) | undefined
}

/** A vehicle of the whole fleet in scope, found by code or name. When the page already knows it, pin it instead. */
export const VehicleField = kitField(function VehicleField({
  name,
  label,
  help,
  placeholder,
  disabled,
  onRegisterNew,
}: VehicleFieldProps) {
  const commandLabel = useCommandLabel()
  const { field, frame, describedBy, required, error } = useKitField(name, help)
  const options = useAssetOptions(ALL_BRANCHES)
  return (
    <FieldFrame label={label} help={help} frame={frame}>
      <SearchControl
        id={frame.id}
        triggerRef={field.ref}
        options={options}
        value={typeof field.value === "string" ? field.value : undefined}
        onChange={field.onChange}
        onBlur={field.onBlur}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        invalid={error !== undefined}
        describedBy={describedBy}
        registerNew={
          onRegisterNew === undefined ? undefined : { label: commandLabel("register-asset"), onSelect: onRegisterNew }
        }
      />
    </FieldFrame>
  )
}, "vehicle")
