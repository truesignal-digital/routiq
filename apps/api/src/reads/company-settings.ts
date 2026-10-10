import type { CompanySettingsResponse } from "@routiq/contracts";
import type { FastifyInstance } from "fastify";
import type { RequireAuth } from "../auth/plugin.js";
import type { Db } from "../db/client.js";
import { defineRead } from "./define-read.js";
import { loadSummarySchedule } from "./overview-notice.js";

/**
 * `GET /v1/company-settings` (#669): the company-wide settings that belong to
 * no module, for the Company settings page. Direction's alone, like the
 * commands that change them; the whole workspace, so no branch narrows it.
 */
export function registerCompanySettingsReadRoutes(app: FastifyInstance, db: Db, requireAuth: RequireAuth) {
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/company-settings", module: "CORE", roles: ["DIRECTOR"], branchScope: "workspace" },
    async ({ auth, read }): Promise<CompanySettingsResponse> =>
      read(async (tx) => {
        const { schedule, version } = await loadSummarySchedule(tx, auth.workspaceId);
        return { summarySchedule: schedule, version };
      }),
  );
}
