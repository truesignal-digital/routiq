import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { useVehicle, type PanelForm } from "../context.js";
import { recordReference, samePanel, type PanelRef } from "../model.js";
import { DocumentRecord } from "./DocumentRecord.js";
import { EntryRecord } from "./EntryRecord.js";
import { IssueRecord } from "./IssueRecord.js";
import { NoteRecord } from "./NoteRecord.js";
import { ReadingsRecord } from "./ReadingsRecord.js";
import { StandaloneForm } from "./StandaloneForm.js";
import { TripRecord } from "./TripRecord.js";
import { WorkOrderRecord } from "./WorkOrderRecord.js";

/**
 * One overlay for any record. A record's actions open their forms inside it,
 * with the way back to the record — never a second overlay on top.
 */
export function RecordPanel() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { panel } = useVehicle();
  const { current, form, previous } = panel;
  const standalone = form !== undefined && form.record === undefined ? form : undefined;
  const recordForm =
    form !== undefined && form.record !== undefined && samePanel(form.record, current) ? form : undefined;
  const open = current !== undefined || standalone !== undefined;

  return (
    <Sheet open={open} onOpenChange={(next) => !next && panel.close()}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "gap-0 overflow-y-auto",
          isMobile ? "max-h-[92vh] rounded-t-xl" : "data-[side=right]:sm:max-w-lg",
        )}
      >
        {standalone !== undefined ? (
          <StandaloneForm stepKey={standalone.key} />
        ) : current !== undefined ? (
          <>
            {previous !== undefined && recordForm === undefined && (
              <button
                type="button"
                onClick={panel.back}
                className="flex items-center gap-1 self-start px-4 pt-3 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-3.5" aria-hidden />
                {t("vehicle.panel.backTo", backToValues(previous))}
              </button>
            )}
            <RecordView key={panelKey(current)} record={current} form={recordForm} />
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function panelKey(ref: PanelRef): string {
  return ref.kind === "readings" ? ref.kind : `${ref.kind}:${ref.id}`;
}

function backToValues(ref: PanelRef): { kind: string; ref: string } {
  return { kind: ref.kind, ref: ref.kind === "readings" ? "" : recordReference(ref.id) };
}

function RecordView({ record, form }: { record: PanelRef; form: PanelForm | undefined }) {
  switch (record.kind) {
    case "work_order":
      return <WorkOrderRecord id={record.id} form={form} />;
    case "issue":
      return <IssueRecord id={record.id} form={form} />;
    case "entry":
      return <EntryRecord id={record.id} form={form} />;
    case "trip":
      return <TripRecord id={record.id} form={form} />;
    case "document":
      return <DocumentRecord id={record.id} form={form} />;
    case "note":
      return <NoteRecord id={record.id} form={form} />;
    case "readings":
      return <ReadingsRecord form={form} />;
  }
}
