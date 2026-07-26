import { useEntry } from "./useEntry.js";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";

interface ReversalLinkProps {
  entryId: string;
  type: "reverses" | "reversedBy";
}

export function ReversalLink({ entryId, type }: ReversalLinkProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const entryQuery = useEntry(entryId);

  const label =
    type === "reverses"
      ? t("finance.entries.detail.reversesEntry")
      : t("finance.entries.detail.reversedByEntry");

  const displayText =
    entryQuery.data?.entryNumber ?? "…";

  return (
    <button
      type="button"
      onClick={() =>
        void navigate({
          to: "/finance/entries/$entryId",
          params: { entryId },
        })
      }
      className="block text-left text-sm text-primary hover:underline"
    >
      {label} #{displayText}
    </button>
  );
}
