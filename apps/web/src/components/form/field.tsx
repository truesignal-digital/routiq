import { useId, type ReactNode } from "react"
import { useController, useFormContext, type ControllerRenderProps, type FieldValues } from "react-hook-form"

import { cn } from "@/lib/utils"
import { useFieldRequired } from "./form-layout.js"

/** What every field-kit field takes. */
export interface KitFieldProps {
  /** The form value's name, dotted for nested values. */
  name: string
  /** Sentence case, no colon, no "(optional)": the asterisk says what is required. */
  label: string
  /** One line under the field: what to type, or what happens to it. */
  help?: ReactNode | undefined
  placeholder?: string | undefined
  disabled?: boolean | undefined
}

export interface KitFieldState {
  field: ControllerRenderProps<FieldValues, string>
  id: string
  required: boolean
  error: string | undefined
  /** For the control's `aria-describedby`: the help, then the error. */
  describedBy: string | undefined
  frame: { id: string; helpId: string; errorId: string; required: boolean; error: string | undefined }
}

/** Binds a kit field to the layout's form: value, error, and "required" from the schema. */
export function useKitField(name: string, help: ReactNode): KitFieldState {
  const { control } = useFormContext()
  const { field, fieldState } = useController({ name, control })
  const id = useId()
  const required = useFieldRequired(name)
  const error = fieldState.error?.message
  const helpId = `${id}-help`
  const errorId = `${id}-error`
  const describedBy =
    [help === undefined || help === null ? undefined : helpId, error === undefined ? undefined : errorId]
      .filter((part) => part !== undefined)
      .join(" ") || undefined
  return { field, id, required, error, describedBy, frame: { id, helpId, errorId, required, error } }
}

/**
 * The frame every kit field shares: the label above (13 px, semibold) with a
 * red asterisk when required, the control, then the help and, under it, the
 * error (12 px). The error adds a line; it never replaces the help.
 */
export function FieldFrame({
  label,
  help,
  frame,
  group = false,
  className,
  children,
}: {
  label: string
  help?: ReactNode | undefined
  frame: KitFieldState["frame"]
  /** A control made of several parts (segmented choice, file picker): the label names the group. */
  group?: boolean | undefined
  className?: string | undefined
  children: ReactNode
}) {
  const labelId = `${frame.id}-label`
  // The asterisk sits beside the label, not in it: the control says
  // aria-required, and the label stays the field's plain name.
  const marker = frame.required && (
    <span aria-hidden data-slot="kit-required" className="text-[13px] leading-tight font-semibold text-destructive">
      *
    </span>
  )
  return (
    <div
      data-slot="kit-field"
      data-required={frame.required || undefined}
      data-invalid={frame.error !== undefined || undefined}
      role={group ? "group" : undefined}
      aria-labelledby={group ? labelId : undefined}
      className={cn("flex min-w-0 flex-col gap-1.5", className)}
    >
      <div className="flex items-baseline gap-0.5">
        {group ? (
          <span id={labelId} data-slot="kit-label" className="text-[13px] leading-tight font-semibold">
            {label}
          </span>
        ) : (
          <label
            id={labelId}
            htmlFor={frame.id}
            data-slot="kit-label"
            className="text-[13px] leading-tight font-semibold"
          >
            {label}
          </label>
        )}
        {marker}
      </div>
      {children}
      {help !== undefined && help !== null && (
        <p id={frame.helpId} data-slot="kit-help" className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
      {frame.error !== undefined && (
        <p id={frame.errorId} data-slot="kit-error" className="text-xs text-destructive">
          {frame.error}
        </p>
      )}
    </div>
  )
}
