import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { DiscardGuardScope, formPanelClassName, useDiscardGuard } from "@/components/command-form.js";
import { useIsMobile } from "@/hooks/use-mobile";
import { contributes } from "@/modules/manifest.js";
import { useVehicle, type PanelForm } from "../context.js";
import { recordReference, samePanel, type PanelRef } from "../model.js";
import { DocumentRecord } from "./DocumentRecord.js";
import { EntryRecord } from "./EntryRecord.js";
import { IssueRecord } from "./IssueRecord.js";
import { NoteRecord } from "./NoteRecord.js";
import { ReadingsRecord } from "./ReadingsRecord.js";
import { PanelMissing } from "./shared.js";
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
  const { guard, dialog } = useDiscardGuard();
  // Repeating cost lines take the Line items width, as they do from Maintenance.
  const width = recordForm?.key === "complete-work-order" ? "line-items" : "record";

  return (
    <Sheet open={open} onOpenChange={(next) => !next && guard.confirm(panel.close)}>
      <SheetContent side={isMobile ? "bottom" : "right"} className={formPanelClassName(isMobile, width)}>
        <DiscardGuardScope guard={guard}>
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
        </DiscardGuardScope>
        {dialog}
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
  const { viewer } = useVehicle();
  // A record of a module that is off is not there to open, even from a link.
  if (!contributes("recordPanels", record.kind, viewer.enabledModules)) return <PanelMissing />;
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
