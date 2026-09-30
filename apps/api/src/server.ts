import "dotenv/config";
import { MODULE_CODES } from "@routiq/contracts";
import { and, eq, sql } from "drizzle-orm";
import Fastify from "fastify";
import { LocalSessionProvider } from "./auth/local.js";
import { makeRequireAuth, registerAuthRoutes } from "./auth/plugin.js";
import type { IdentityProvider } from "./auth/types.js";
import "./commands/register-asset.js";
import "./commands/add-or-renew-document.js";
import "./commands/module-toggle.js";
import "./commands/update-approval-threshold.js";
import "./commands/asset-lifecycle.js";
import "./commands/record-financial-entry.js";
import "./commands/entry-decisions.js";
import "./commands/period-commands.js";
import "./commands/reverse-entry.js";
import "./commands/register-person.js";
import "./commands/create-branch.js";
import "./commands/branch-admin.js";
import "./commands/create-activity.js";
import "./commands/activity-legs.js";
import "./commands/substitute-asset.js";
import "./commands/activity-close.js";
import "./commands/record-sheet.js";
import "./commands/provision-workspace.js";
import "./commands/category.js";
import "./commands/set-template-preset.js";
import "./commands/members.js";
import "./commands/report-issue.js";
import "./commands/issue-decisions.js";
import "./commands/work-orders.js";
import "./commands/work-order-decisions.js";
import "./commands/release-asset-to-service.js";
import "./commands/add-note.js";
import "./commands/attach-evidence.js";
import { registerArtifactRoutes } from "./artifacts/routes.js";
import { listCommands } from "./commands/dispatcher.js";
import { commandPayloadHmacKey } from "./commands/payload-fingerprint.js";
import { registerCommandRoutes } from "./commands/routes.js";
import type { Db } from "./db/client.js";
import { workspaceModules } from "./db/schema.js";
import { inWorkspace } from "./db/tenant.js";
import { enabledPresets } from "./templates/registry.js";
import type { ObjectStorage } from "./storage/types.js";
import { registerActivityReadRoutes } from "./reads/activities.js";
import { registerAssetReadRoutes } from "./reads/assets.js";
import { registerDashboardReadRoutes } from "./reads/dashboard.js";
import { registerFinanceReadRoutes } from "./reads/finance.js";
import { registerMemberReadRoutes } from "./reads/members.js";
import { registerBranchReadRoutes } from "./reads/branches.js";
import { registerHistoryReadRoutes } from "./reads/history.js";
import { registerMaintenanceReadRoutes } from "./reads/maintenance.js";
import { requireReadGates } from "./reads/define-read.js";

export interface ServerDeps {
  db: Db;
  authDb: Db;
  identity?: IdentityProvider;
  storage?: ObjectStorage;
  logger?: boolean | object;
}

export function buildServer({
  db,
  authDb,
  identity = new LocalSessionProvider(authDb),
  storage,
  logger = true,
}: ServerDeps) {
  // Auto request-logging is off because Fastify's completion line binds reply.log
  // before routes can attach commandId/workspaceId (§8: both on every log line).
  const app = Fastify({ logger, disableRequestLogging: true });
  const requireAuth = makeRequireAuth(authDb, identity);
  // Before any route: a /v1 GET registered without defineRead fails the boot.
  requireReadGates(app);

  app.addHook("onReady", async () => {
    const result = await db.execute(sql`
      select rolsuper, rolbypassrls
      from pg_roles
      where rolname = current_user
    `);
    const role = result.rows[0] as
      | { rolsuper: boolean; rolbypassrls: boolean }
      | undefined;
    if (!role || role.rolsuper || role.rolbypassrls) {
      throw new Error(
        "runtime database role must be non-superuser without BYPASSRLS",
      );
    }

    // Checked at boot rather than on the first write: a box missing the key
    // would otherwise come up healthy and fail on the first command an
    // operator ran, which is the worst moment to discover a config gap.
    commandPayloadHmacKey();
  });

  app.addHook("onResponse", (req, reply, done) => {
    req.log.info({
      event: "request.completed",
      method: req.method,
      url: req.url,
      statusCode: reply.statusCode,
      durationMs: reply.elapsedTime,
    });
    done();
  });

  app.get("/health", async () => {
    await db.execute(sql`select 1`);
    return { status: "ok" };
  });

  registerAuthRoutes(app, authDb);
  registerCommandRoutes(app, db, requireAuth);
  registerAssetReadRoutes(app, db, requireAuth);
  registerFinanceReadRoutes(app, db, requireAuth);
  registerDashboardReadRoutes(app, db, requireAuth);
  registerActivityReadRoutes(app, db, requireAuth);
  registerMemberReadRoutes(app, db, requireAuth);
  registerBranchReadRoutes(app, db, requireAuth);
  registerHistoryReadRoutes(app, db, requireAuth);
  registerMaintenanceReadRoutes(app, db, requireAuth);
  if (storage) registerArtifactRoutes(app, db, storage, requireAuth);
  app.get("/v1/me", { preHandler: requireAuth }, async (req) => {
    const auth = req.auth;
    if (!auth) return req.auth;
    const { disabled, presets } = await inWorkspace(db, auth.workspaceId, async (tx) => ({
      disabled: await tx
        .select({ moduleCode: workspaceModules.moduleCode })
        .from(workspaceModules)
        .where(
          and(
            eq(workspaceModules.workspaceId, auth.workspaceId),
            eq(workspaceModules.enabled, false),
          ),
        ),
      // Grandfather clause and ordering both live in the helper, so this set
      // and the dispatcher's per-command check can never disagree.
      presets: await enabledPresets(tx, auth.workspaceId),
    }));
    const disabledCodes = new Set(disabled.map((row) => row.moduleCode));
    return {
      ...auth,
      enabledModules: MODULE_CODES.filter((code) => !disabledCodes.has(code)),
      enabledPresets: presets,
    };
  });
  app.get("/v1/commands", { preHandler: requireAuth }, async () => ({
    commands: listCommands(),
  }));

  return app;
}

const isMain = process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js");
if (isMain) {
  const { initSentry } = await import("./observability/sentry.js");
  initSentry();
  const { authDb, db } = await import("./db/client.js");
  const app = buildServer({ db, authDb });
  const port = Number(process.env["PORT"] ?? 3001);
  app.listen({ port, host: "0.0.0.0" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
