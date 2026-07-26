import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
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

function StatusBadge({
  className,
  tone = "neutral",
  children,
  ...props
}: useRender.ComponentProps<typeof Badge> &
  VariantProps<typeof statusBadgeVariants> & {
    children: ReactNode
  }) {
  return (
    <Badge
      variant="ghost"
      className={cn(statusBadgeVariants({ tone }), className)}
      {...props}
    >
      {children}
    </Badge>
  )
}

export { StatusBadge, statusBadgeVariants }
