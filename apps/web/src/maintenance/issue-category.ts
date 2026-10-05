import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useCategories } from "@/documents/useCategories.js";
import { localizedLabel } from "@/lib/format.js";

/** A problem's category is a code; its label comes from the ISSUE_TYPE list, else the code itself. */
export function useIssueCategoryLabel() {
  const { i18n } = useTranslation();
  const types = useCategories("ISSUE_TYPE");
  const language = i18n.language;
  return useCallback(
    (code: string | null) => {
      if (code === null) return null;
      const type = types.data?.find((candidate) => candidate.code === code);
      return type === undefined ? code : localizedLabel(type, language);
    },
    [types.data, language],
  );
}
