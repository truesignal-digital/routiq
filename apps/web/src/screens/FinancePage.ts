/**
 * The Money page's frame and its tabs in one file for the router: they load
 * as one chunk, so moving between tabs never waits on a download and the
 * shared table and form code is not split into extra files (#664).
 */
export { FinanceScreen } from "./FinanceScreen.js";
export { FinanceOverviewScreen } from "./FinanceOverviewScreen.js";
export { FinanceEntriesScreen } from "./FinanceEntriesScreen.js";
export { FinanceApproveScreen } from "./FinanceApproveScreen.js";
export { FinanceRecordScreen } from "./FinanceRecordScreen.js";
