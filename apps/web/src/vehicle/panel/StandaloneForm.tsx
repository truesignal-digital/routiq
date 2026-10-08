import { ReadingForm } from "@/activities/ReadingForm.js";
import { AssetActionForm } from "@/assets/AssetActions.js";
import { DocumentForm } from "@/documents/DocumentForm.js";
import { RecordEntryForm } from "@/finance/RecordEntryForm.js";
import { CreateWorkOrderForm, ReportIssueForm } from "@/maintenance/MaintenanceDialogs.js";
import { useVehicle } from "../context.js";
import { AddNoteForm } from "../forms/AddNoteForm.js";
import { useCustodianSlot } from "../forms/CustodianField.js";
import { LogFuelForm } from "../forms/LogFuelForm.js";
import type { StepKey } from "../model.js";

/**
 * A form about the vehicle itself, with no record behind it: the panel's only
 * page. The vehicle is pinned; every write refreshes the vehicle's reads.
 */
export function StandaloneForm({ stepKey }: { stepKey: StepKey }) {
  const { asset, pinnedLabel, panel, refresh } = useVehicle();
  const done = () => void refresh();
  const dismiss = panel.closeForm;
  const lastReading =
    asset.lastReading === null
      ? undefined
      : { readingType: asset.lastReading.readingType, value: asset.lastReading.value };
  const target = { id: asset.id, lifecycleStatus: asset.lifecycleStatus, rowVersion: asset.rowVersion };

  switch (stepKey) {
    case "log-fuel":
      return (
        <LogFuelForm
          surface="panel"
          assetId={asset.id}
          assetLabel={pinnedLabel}
          branchCode={asset.branch.code}
          lastReading={lastReading}
          onDone={done}
          onDismiss={dismiss}
        />
      );
    case "record-expense":
    case "record-revenue":
      return (
        <RecordEntryForm
          surface="panel"
          initialDirection={stepKey === "record-expense" ? "EXPENSE" : "REVENUE"}
          lockDirection
          pinnedAssetId={asset.id}
          pinnedAssetLabel={pinnedLabel}
          defaultBranchCode={asset.branch.code}
          onRecorded={() => {
            done();
            dismiss();
          }}
          onDismiss={dismiss}
        />
      );
    case "record-reading":
      return (
        <ReadingForm
          surface="panel"
          pinnedAssetId={asset.id}
          pinnedAssetLabel={pinnedLabel}
          lastReading={lastReading}
          onDone={done}
          onDismiss={dismiss}
        />
      );
    case "add-note":
      return (
        <AddNoteForm surface="panel" assetId={asset.id} assetLabel={pinnedLabel} onDone={done} onDismiss={dismiss} />
      );
    case "report-issue":
      return (
        <ReportIssueForm
          surface="panel"
          pinnedAssetId={asset.id}
          pinnedAssetLabel={pinnedLabel}
          onDone={done}
          onDismiss={dismiss}
        />
      );
    case "create-work-order":
      return (
        <CreateWorkOrderForm
          surface="panel"
          pinnedAssetId={asset.id}
          pinnedAssetLabel={pinnedLabel}
          onDone={done}
          onDismiss={dismiss}
        />
      );
    case "change-custodian":
      return <CustodianForm />;
    case "transfer-branch":
      return (
        <AssetActionForm surface="panel" asset={target} action="assign" onDone={done} onDismiss={dismiss} />
      );
    case "commission":
      return (
        <AssetActionForm surface="panel" asset={target} action="commission" onDone={done} onDismiss={dismiss} />
      );
    case "add-document":
      return (
        <DocumentForm
          surface="panel"
          pinnedAssetId={asset.id}
          pinnedAssetLabel={pinnedLabel}
          onDone={done}
          onDismiss={dismiss}
        />
      );
    default:
      return null;
  }
}

function CustodianForm() {
  const { asset, panel, refresh } = useVehicle();
  const custodian = useCustodianSlot(asset.id, asset.custodian);
  return (
    <AssetActionForm
      surface="panel"
      asset={{ id: asset.id, lifecycleStatus: asset.lifecycleStatus, rowVersion: asset.rowVersion }}
      action="custodian"
      custodian={custodian}
      onDone={() => void refresh()}
      onDismiss={panel.closeForm}
    />
  );
}
