import { useTranslation } from "react-i18next";
import { formatDateTime } from "@/lib/format.js";
import { useIssueCategoryLabel } from "@/maintenance/issue-category.js";
import {
  CreateWorkOrderForm,
  IssueDecisionForm,
  IssueSeverityForm,
  ReleaseForm,
} from "@/maintenance/MaintenanceDialogs.js";
import { IssueStatusBadge } from "@/maintenance/IssueStatusBadge.js";
import { Chronologie } from "@/maintenance/WorkOrderSheet.js";
import { useVehicle, type PanelForm } from "../context.js";
import { groundingFacts, isActiveWorkOrder, issueSteps } from "../flow.js";
import { recordReference } from "../model.js";
import { DetailHeader, DetailSection, FactList, LinkButton, Note, SafetyMark } from "../parts.js";
import { useIssue } from "../useVehicle.js";
import { PanelFooter, PanelLoading, PanelMissing, RecordFileRow, useFormHost } from "./shared.js";

const TITLE_MAX = 120;

export function IssueRecord({ id, form }: { id: string; form: PanelForm | undefined }) {
  const { t, i18n } = useTranslation();
  const { asset, viewer, panel, gates, pinnedLabel } = useVehicle();
  const query = useIssue(id, gates.maintenance);
  const categoryLabel = useIssueCategoryLabel();
  const host = useFormHost(t("vehicle.panel.issueTitle", { ref: recordReference(id) }));
  const locale = i18n.language;

  if (!gates.maintenance) return <PanelMissing />;
  if (query.isPending) return <PanelLoading />;
  if (query.isError || query.data === undefined) return <PanelMissing onRetry={() => void query.refetch()} />;
  const issue = query.data;
  if (issue.asset.id !== asset.id) return <PanelMissing />;

  const grounding = groundingFacts(asset);
  const planned = issue.workOrders.some((wo) => isActiveWorkOrder(wo.status));
  const steps = issueSteps(
    { id: issue.id, status: issue.status, safetyCritical: issue.safetyCritical, planned },
    viewer,
    grounding,
  );

  if (form !== undefined) {
    const common = { surface: "panel" as const, back: host.back, onDone: host.onDone, onDismiss: host.onDismiss };
    switch (form.key) {
      case "create-work-order":
        return (
          <CreateWorkOrderForm
            {...common}
            issue={issue}
            pinnedAssetId={asset.id}
            pinnedAssetLabel={pinnedLabel}
          />
        );
      case "resolve-issue":
        return <IssueDecisionForm {...common} issue={issue} decision="resolve" />;
      case "dismiss-issue":
        return <IssueDecisionForm {...common} issue={issue} decision="dismiss" />;
      case "raise-severity":
        return <IssueSeverityForm {...common} issue={issue} raise />;
      case "lower-severity":
        return <IssueSeverityForm {...common} issue={issue} raise={false} />;
      case "release":
        return (
          <ReleaseForm {...common} subject={{ kind: "override", assetId: asset.id, issue }} />
        );
      default:
        return null;
    }
  }

  const reportedBy = issue.chronologie[0]?.actor.displayName ?? t("history.actor.unknown");
  const title =
    issue.description.length > TITLE_MAX
      ? `${issue.description.slice(0, TITLE_MAX - 1).trimEnd()}…`
      : issue.description;
  const category = categoryLabel(issue.category);
  const unplanned = issue.status === "OPEN" && !planned;

  return (
    <>
      <DetailHeader
        eyebrow={t("vehicle.panel.issueEyebrow", { ref: recordReference(issue.id) })}
        title={title}
        meta={
          <>
            <IssueStatusBadge issue={issue} />
            {issue.safetyCritical && <SafetyMark />}
          </>
        }
      />
      <div className="space-y-6 p-4">
        {title !== issue.description && <p className="text-sm">{issue.description}</p>}
        <FactList
          rows={[
            [t("vehicle.panel.category"), category ?? t("vehicle.details.notRecorded")],
            [
              t("vehicle.panel.reported"),
              t("vehicle.panel.atBy", { date: formatDateTime(issue.reportedAt, locale), name: reportedBy }),
            ],
            [t("vehicle.panel.photos"), t("vehicle.panel.photoCount", { count: issue.artifactCount })],
            [
              t("vehicle.panel.workOrders"),
              issue.workOrders.length === 0 ? (
                t("vehicle.panel.noneYet")
              ) : (
                <span className="flex flex-wrap gap-x-2">
                  {issue.workOrders.map((wo) => (
                    <LinkButton key={wo.id} onClick={() => panel.openRecord({ kind: "work_order", id: wo.id })}>
                      {recordReference(wo.id)}
                    </LinkButton>
                  ))}
                </span>
              ),
            ],
          ]}
        />
        {/* An API older than the file lists sends none; show nothing rather than fail. */}
        {(issue.artifacts ?? []).length > 0 && (
          <DetailSection title={t("vehicle.panel.photos")}>
            <ul className="divide-y rounded-lg border">
              {(issue.artifacts ?? []).map((file, index) => (
                <RecordFileRow
                  key={file.artifactId}
                  name={file.originalFileName ?? t("vehicle.panel.photoNumber", { number: index + 1 })}
                  downloadPath={`/v1/issues/${issue.id}/artifacts/${file.artifactId}/download-url`}
                />
              ))}
            </ul>
          </DetailSection>
        )}
        {issue.resolutionNote !== null && (
          <DetailSection title={t("vehicle.panel.resolution")}>
            <p className="text-sm">{issue.resolutionNote}</p>
          </DetailSection>
        )}
        {issue.dismissReason !== null && (
          <DetailSection title={t("vehicle.panel.reason")}>
            <p className="text-sm">{issue.dismissReason}</p>
          </DetailSection>
        )}
        {issue.safetyCritical && <Note>{t("vehicle.panel.safetyCriticalNote")}</Note>}
        <DetailSection title={t("maintenance.detail.chronologie")}>
          <Chronologie events={issue.chronologie} locale={locale} />
        </DetailSection>
      </div>
      <PanelFooter
        steps={steps}
        waiting={unplanned ? t("vehicle.panel.waitingOn.planning") : null}
        onStep={panel.openStep}
      />
    </>
  );
}
