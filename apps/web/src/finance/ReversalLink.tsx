import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { RecordText } from "@/components/record-number";
import { useEntry } from "./useEntry.js";

interface ReversalLinkProps {
  entryId: string;
  type: "reverses" | "reversedBy";
}

export function ReversalLink({ entryId, type }: ReversalLinkProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const entryQuery = useEntry(entryId);

  const number = entryQuery.data?.entryNumber ?? "…";
  const text =
    type === "reverses"
      ? t("finance.entries.detail.reversesEntry", { number })
      : t("finance.entries.detail.reversedByEntry", { number });

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
      <RecordText text={text} numbers={[entryQuery.data?.entryNumber]} />
    </button>
  );
}
