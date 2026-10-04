import type { WorkOrderStatus } from "@routiq/contracts";

const ACTIVE_WORK_ORDER: readonly WorkOrderStatus[] = ["SUBMITTED", "APPROVED", "COMPLETION_SUBMITTED"];

/** Still moving through the flow; COMPLETED, REJECTED and CANCELLED are done. */
export function isActiveWorkOrder(status: WorkOrderStatus): boolean {
  return ACTIVE_WORK_ORDER.includes(status);
}
