import { useTranslation } from "react-i18next";
import type { MemberBranchScope } from "@routiq/contracts";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export interface BranchOption {
  id: string;
  name: string;
}

/**
 * Branch scope as the membership stores it: every branch, or an explicit list.
 * The two are one control rather than two fields because they are one answer —
 * unticking "all branches" has to leave the admin somewhere to say which ones.
 *
 * Ids, not codes: the member commands take ids (the screen already holds the
 * branch list it rendered), unlike provisioning which names branches it is
 * about to create.
 */
export function BranchScopeField({
  branches,
  value,
  onChange,
  disabled = false,
}: {
  branches: readonly BranchOption[];
  value: MemberBranchScope;
  onChange: (value: MemberBranchScope) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const selected = value === "ALL" ? [] : value;

  function toggleBranch(branchId: string, checked: boolean) {
    const next = checked
      ? [...selected, branchId]
      : selected.filter((id) => id !== branchId);
    // An empty pick list is not a scope the command accepts; falling back to
    // ALL would silently widen it, so the last branch simply stays ticked.
    onChange(next.length === 0 ? "ALL" : next);
  }

  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className="text-sm font-medium">{t("users.form.branchScope")}</legend>

      <Label className="flex items-center gap-2 text-sm font-normal">
        <Checkbox
          checked={value === "ALL"}
          onCheckedChange={(checked) =>
            onChange(checked ? "ALL" : (branches[0] ? [branches[0].id] : "ALL"))
          }
        />
        {t("users.form.allBranches")}
      </Label>

      {value !== "ALL" && (
        <div className="flex flex-col gap-2 pl-6">
          {branches.map((branch) => (
            <Label
              key={branch.id}
              className="flex items-center gap-2 text-sm font-normal"
            >
              <Checkbox
                checked={selected.includes(branch.id)}
                onCheckedChange={(checked) => toggleBranch(branch.id, checked)}
              />
              {branch.name}
            </Label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/** What a row's scope reads as, once branch ids are given their names. */
export function branchScopeLabel(
  scope: MemberBranchScope,
  branches: readonly BranchOption[],
  allBranchesLabel: string,
): string {
  if (scope === "ALL") return allBranchesLabel;
  return scope
    .map((id) => branches.find((branch) => branch.id === id)?.name ?? id)
    .join(", ");
}
