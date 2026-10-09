import type { HistoryCodeSet } from "@routiq/contracts";

/**
 * The words for every code a history diff can name (#110). Each set points at
 * the labels the app already shows for it — the status badges, the forms, the
 * warnings — so a work order reads "Completed" in its history exactly as on its
 * badge. Sets with no label elsewhere get theirs under `history.code`.
 * `code-labels.test.ts` checks every code of every set against both locales.
 */
export const HISTORY_CODE_LABEL_KEY: Record<HistoryCodeSet, (code: string) => string> = {
  activityStatus: (code) => `activities.status.${code}`,
  activityCompleteness: (code) => `activities.completeness.${code}`,
  completenessCode: (code) => `warnings.${code}`,
  segmentRole: (code) => `activities.roles.${code}`,
  loadState: (code) => `activities.record.legs.loadStates.${code}`,
  personRole: (code) => `persons.roles.${code}`,
  entryStatus: (code) => `finance.entries.status.${code}`,
  entryDirection: (code) => `history.code.entryDirection.${code}`,
  paymentMethod: (code) => `finance.record.paymentMethods.${code.toLowerCase()}`,
  estimateStatus: (code) => `history.code.estimateStatus.${code}`,
  cancellationReason: (code) => `reasonCodes.${code}`,
  periodStatus: (code) => `history.code.periodStatus.${code}`,
  workOrderStatus: (code) => `maintenance.workOrders.status.${code}`,
  costOutcome: (code) => `history.code.costOutcome.${code}`,
  issueStatus: (code) => `maintenance.issues.status.${code}`,
  lifecycleStatus: (code) => `assets.status.${code}`,
  readingType: (code) => `activities.record.readings.types.${code}`,
  readingSource: (code) => `activities.detail.readings.sources.${code}`,
  template: (code) => `assets.form.templates.${code}`,
  module: (code) => `history.code.module.${code}`,
  categoryKind: (code) => `history.code.categoryKind.${code}`,
  profitabilityLayer: (code) => `vehicle.layers.${code}`,
  evidencePolicy: (code) => `history.code.evidencePolicy.${code}`,
  approvalCommand: (code) => `commands.${code}.label`,
};
