import { Building2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ALL_BRANCHES, useCurrentBranch } from "./branch-context.js";

/**
 * Which agency the shell is working in. Rendered only when the caller's scope
 * spans more than one active branch — a single-branch member has nothing to
 * choose, and the forms already collapse their branch field for them.
 */
export function BranchSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { currentBranchId, options, setCurrentBranchId } = useCurrentBranch();

  if (options.length < 2) return null;

  const items = [
    { value: ALL_BRANCHES, label: t("shell.branch.all") },
    ...options.map((branch) => ({ value: branch.id, label: branch.name })),
  ];

  return (
    <Select
      items={items}
      value={currentBranchId}
      onValueChange={(value: string | null) =>
        setCurrentBranchId(value ?? ALL_BRANCHES)
      }
    >
      <SelectTrigger
        aria-label={t("shell.branch.label")}
        className={cn("h-9 w-auto max-w-44 gap-2", className)}
      >
        <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <SelectValue className="truncate" />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
