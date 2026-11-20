import { useState } from "react";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { notifyCommandError } from "@/lib/notify.js";
import { downloadEntriesExport, type EntriesExportParams } from "./exportEntries.js";

/** Export to Excel (#429): the list as it is filtered, with a Check sheet. */
export function ExportEntriesButton({ params }: { params: EntriesExportParams }) {
  const { t, i18n } = useTranslation();
  const [preparing, setPreparing] = useState(false);
  const exportList = async () => {
    setPreparing(true);
    try {
      const result = await downloadEntriesExport(params, i18n.language);
      if (!result.ok) notifyCommandError("finance", result.code);
    } finally {
      setPreparing(false);
    }
  };
  return (
    <Button
      type="button"
      variant="outline"
      size="desktop-sm"
      disabled={preparing}
      data-slot="entries-export"
      onClick={() => void exportList()}
    >
      <FileText aria-hidden />
      {preparing ? t("finance.export.preparing") : t("finance.export.button")}
    </Button>
  );
}
