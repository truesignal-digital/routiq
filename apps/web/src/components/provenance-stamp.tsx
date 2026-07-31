import { useTranslation } from "react-i18next";
import { formatDate } from "@/lib/format.js";
import { cn } from "@/lib/utils.js";

export interface ProvenanceStampProps {
  templateCode?: string | null;
  templateVersion?: number | null;
  createdAt?: string | null;
  /** The command that wrote the row (§3.4 provenance), not the row's own id. */
  commandId?: string | null;
  className?: string;
}

/** Enough of a UUID to match against a receipt without wrapping on a phone. */
function shortId(id: string): string {
  return id.slice(0, 8);
}

/**
 * Where a record came from, in the smallest type on the page: which template
 * shaped it, when it was written, and which command wrote it. Every business
 * row carries this, so the component takes the parts it is given and omits the
 * ones it is not.
 */
export function ProvenanceStamp({
  templateCode,
  templateVersion,
  createdAt,
  commandId,
  className,
}: ProvenanceStampProps) {
  const { t, i18n } = useTranslation();

  const parts: string[] = [];
  if (templateCode) {
    parts.push(
      templateVersion == null
        ? templateCode
        : t("provenance.template", { code: templateCode, version: templateVersion }),
    );
  }
  if (createdAt) {
    const date = formatDate(createdAt, i18n.language);
    if (date) parts.push(t("provenance.created", { date }));
  }
  if (commandId) {
    parts.push(t("provenance.command", { id: shortId(commandId) }));
  }

  if (parts.length === 0) return null;

  return (
    <footer
      className={cn(
        "text-muted-foreground text-xs tracking-wide",
        className,
      )}
      {...(commandId ? { title: commandId } : {})}
    >
      {parts.join(" · ")}
    </footer>
  );
}
