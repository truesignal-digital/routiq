import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import {
  CircleCheck,
  CircleX,
  Clock,
  LoaderCircle,
  type LucideIcon,
} from "lucide-react"
import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge.js"
import { cn } from "@/lib/utils.js"

const statusBadgeVariants = cva("", {
  variants: {
    tone: {
      neutral: "bg-foreground/[0.05] text-muted-foreground",
      success: "bg-success/10 text-success-foreground",
      warning: "bg-warning/10 text-warning-foreground",
      info: "bg-info/10 text-info-foreground",
      danger: "bg-destructive/10 text-destructive",
    },
  },
  defaultVariants: {
    tone: "neutral",
  },
})

type StatusBadgeTone = NonNullable<
  VariantProps<typeof statusBadgeVariants>["tone"]
>

/**
 * What each tone means at a glance. Neutral has none: it covers everything
 * from "not applicable" to "retired", so any glyph would overstate it — the
 * cases that want one (a reversed entry, say) pass their own.
 */
const TONE_ICONS: Record<StatusBadgeTone, LucideIcon | null> = {
  neutral: null,
  success: CircleCheck,
  warning: Clock,
  info: LoaderCircle,
  danger: CircleX,
}

function StatusBadge({
  className,
  tone = "neutral",
  icon,
  children,
  ...props
}: useRender.ComponentProps<typeof Badge> &
  VariantProps<typeof statusBadgeVariants> & {
    /** Omit for the tone's own glyph, `null` for none, or name another. */
    icon?: LucideIcon | null
    children: ReactNode
  }) {
  const Icon = icon === undefined ? TONE_ICONS[tone ?? "neutral"] : icon

  return (
    <Badge
      variant="ghost"
      className={cn(statusBadgeVariants({ tone }), className)}
      {...props}
    >
      {/* The label carries the meaning; the glyph only speeds up scanning. */}
      {Icon && <Icon data-icon="inline-start" aria-hidden />}
      {children}
    </Badge>
  )
}

export { StatusBadge, statusBadgeVariants, TONE_ICONS }
