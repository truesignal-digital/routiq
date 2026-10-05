/**
 * Hands-on smoke of the spine against the local compose Postgres.
 * Prereqs: `docker compose up -d` and `pnpm db:migrate`.
 * Run: pnpm --filter @routiq/api smoke
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { createSession } from "../src/auth/local.js";
import { authDb, authPool, db, pool } from "../src/db/client.js";
import { financialPostings } from "../src/db/schema.js";
import { buildServer } from "../src/server.js";
import { seedMember, seedWorkspace } from "../src/test/seed.js";

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  → ${JSON.stringify(detail)}`}`);
  if (!ok) failures += 1;
}

const app = buildServer({ db, authDb, logger: false });
await app.listen({ port: PORT, host: "127.0.0.1" });

try {
  const slug = `smoke-${Date.now()}`;
  const { workspace, branch } = await seedWorkspace(authDb, slug);
  const admin = await seedMember(authDb, {
    workspaceId: workspace.id,
    role: "DIRECTOR",
    allBranches: true,
    username: "smoke-admin",
    pin: "4821",
  });
  const approver = await seedMember(authDb, {
    workspaceId: workspace.id,
    role: "FINANCE",
    allBranches: true,
    username: "smoke-approver",
    pin: "5732",
  });
  const submitter = await seedMember(authDb, {
    workspaceId: workspace.id,
    role: "DRIVER",
    allBranches: true,
    username: "smoke-submitter",
    pin: "1948",
  });
  const [adminSession, approverSession, submitterSession] = await Promise.all([
    createSession(authDb, {
      principalId: admin.principal.id,
      workspaceId: workspace.id,
    }),
    createSession(authDb, {
      principalId: approver.principal.id,
      workspaceId: workspace.id,
    }),
    createSession(authDb, {
      principalId: submitter.principal.id,
      workspaceId: workspace.id,
    }),
  ]);
  const adminToken = adminSession.token;
  const approverToken = approverSession.token;
  const submitterToken = submitterSession.token;
  console.log(`workspace ${slug} (branch ${branch.code}) seeded\n`);

  const loginRes = await fetch(`${BASE}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceSlug: slug, username: "smoke-admin", pin: "4821" }),
  });
  const { token: loginToken } = (await loginRes.json()) as { token: string };
  check("login issues a token", loginRes.status === 200 && typeof loginToken === "string");

  const badLogin = await fetch(`${BASE}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceSlug: slug, username: "smoke-admin", pin: "9999" }),
  });
  const badBody = await badLogin.json();
  check(
    "wrong PIN → stable code, no English",
    badLogin.status === 401 && JSON.stringify(badBody) === '{"error":{"code":"AUTH_INVALID_CREDENTIALS"}}',
    badBody,
  );

  const authedAs = (authToken: string, path: string, body?: unknown) =>
    fetch(`${BASE}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${authToken}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const authed = (path: string, body?: unknown) => authedAs(adminToken, path, body);

  const me = await (await authed("/v1/me")).json();
  check(
    "/v1/me resolves server-side context",
    (me as { workspaceId: string; role: string }).workspaceId === workspace.id &&
      (me as { role: string }).role === "DIRECTOR",
    me,
  );

  const command = (
    name: string,
    payload: unknown,
    key: string,
    envelope: { commandId?: string; expectedVersion?: number } = {},
  ) => ({
    name,
    version: 1,
    envelope: {
      commandId: envelope.commandId ?? randomUUID(),
      idempotencyKey: key,
      origin: "HUMAN_UI",
      ...(envelope.expectedVersion === undefined
        ? {}
        : { expectedVersion: envelope.expectedVersion }),
    },
    payload,
  });
  /** Commands go to their named route (ADR-0002, ADR-0007), never the generic facade. */
  const sendAs = (authToken: string, cmd: ReturnType<typeof command>) =>
    authedAs(authToken, `/v1/commands/${cmd.name}`, {
      version: cmd.version,
      envelope: cmd.envelope,
      payload: cmd.payload,
    });
  const send = (cmd: ReturnType<typeof command>) => sendAs(adminToken, cmd);
  const assetPayload = (assetId: string, code: string) => ({
    assetId,
    assetCode: code,
    assetClassCode: "TRUCK",
    templateCode: "TRUCKING",
    branchCode: branch.code,
  });

  const assetId = randomUUID();
  const key = `smoke-${randomUUID()}`;
  const first = command("register-asset", assetPayload(assetId, "SMOKE-001"), key);
  const r1 = await send(first);
  const r1b = (await r1.json()) as { recordId: string; idempotentReplay: boolean };
  check("register-asset commits", r1.status === 200 && r1b.recordId === assetId, r1b);

  const r2 = await send(first);
  const r2b = (await r2.json()) as { recordId: string; idempotentReplay: boolean };
  check(
    "exact retry replays original outcome",
    r2.status === 200 && r2b.idempotentReplay === true && r2b.recordId === assetId,
    r2b,
  );

  const r3 = await send(command("register-asset", assetPayload(randomUUID(), "SMOKE-002"), key),
  );
  check("same key + new payload → 409", r3.status === 409, await r3.json());

  const r4 = await send(command("disable-module", { moduleCode: "ASSETS" }, `smoke-${randomUUID()}`),
  );
  check("disable-module ASSETS", r4.status === 200, await r4.json());

  const r5 = await send(command("register-asset", assetPayload(randomUUID(), "SMOKE-003"), `smoke-${randomUUID()}`),
  );
  const r5b = (await r5.json()) as { error?: { code: string } };
  check("register while disabled → MODULE_DISABLED", r5.status === 403 && r5b.error?.code === "MODULE_DISABLED", r5b);

  const r6 = await send(command("enable-module", { moduleCode: "ASSETS" }, `smoke-${randomUUID()}`),
  );
  check("enable-module ASSETS", r6.status === 200, await r6.json());

  const r7 = await send(command("register-asset", assetPayload(randomUUID(), "SMOKE-004"), `smoke-${randomUUID()}`),
  );
  check("register works again", r7.status === 200, await r7.json());

  const currentPeriod = periodCodeFor(new Date());
  const currentEconomicDate = `${currentPeriod}-15`;
  const expensePayload = (
    entryId: string,
    amountMinor: number,
    economicDate = currentEconomicDate,
  ) => ({
    entryId,
    branchCode: branch.code,
    categoryCode: "FUEL",
    economicDate,
    amountMinor,
    paymentMethod: "CASH",
    postings: [{ assetId, amountMinor }],
  });

  const belowThresholdEntryId = randomUUID();
  const belowThresholdRes = await sendAs(
    submitterToken,
    command(
      "record-expense",
      expensePayload(belowThresholdEntryId, 40_000),
      `smoke-${randomUUID()}`,
    ),
  );
  const belowThresholdBody = (await belowThresholdRes.json()) as CommandResult;
  check(
    "expense below threshold auto-posts",
    belowThresholdRes.status === 200 &&
      belowThresholdBody.recordStatus === "POSTED" &&
      belowThresholdBody.warnings?.includes("EVIDENCE_MISSING") === true,
    belowThresholdBody,
  );

  const submittedEntryId = randomUUID();
  const submittedRes = await sendAs(
    submitterToken,
    command(
      "record-expense",
      expensePayload(submittedEntryId, 150_000),
      `smoke-${randomUUID()}`,
    ),
  );
  const submittedBody = (await submittedRes.json()) as CommandResult;
  const approvedRes = await sendAs(
    approverToken,
    command(
      "approve-entry",
      { entryId: submittedEntryId },
      `smoke-${randomUUID()}`,
      { expectedVersion: 1 },
    ),
  );
  const approvedBody = (await approvedRes.json()) as CommandResult;
  check(
    "expense above threshold submitted",
    submittedRes.status === 200 &&
      submittedBody.recordStatus === "SUBMITTED" &&
      approvedRes.status === 200 &&
      approvedBody.recordStatus === "POSTED",
    { submitted: submittedBody, approved: approvedBody },
  );

  const rejectedEntryId = randomUUID();
  const rejectedEntryRes = await sendAs(
    submitterToken,
    command(
      "record-expense",
      expensePayload(rejectedEntryId, 150_000),
      `smoke-${randomUUID()}`,
    ),
  );
  const rejectedEntryBody = (await rejectedEntryRes.json()) as CommandResult;
  const forbiddenDecisionRes = await sendAs(
    submitterToken,
    command(
      "approve-entry",
      { entryId: rejectedEntryId },
      `smoke-${randomUUID()}`,
      { expectedVersion: 1 },
    ),
  );
  const forbiddenDecisionBody = (await forbiddenDecisionRes.json()) as CommandResult;
  const rejectRes = await sendAs(
    approverToken,
    command(
      "reject-entry",
      { entryId: rejectedEntryId, reason: "smoke rejection" },
      `smoke-${randomUUID()}`,
      { expectedVersion: 1 },
    ),
  );
  const rejectBody = (await rejectRes.json()) as CommandResult;
  check(
    "maker-guard forbids submitter role on entry decision",
    rejectedEntryRes.status === 200 &&
      rejectedEntryBody.recordStatus === "SUBMITTED" &&
      forbiddenDecisionRes.status === 403 &&
      rejectRes.status === 200 &&
      rejectBody.recordStatus === "REJECTED",
    {
      submitted: rejectedEntryBody,
      forbidden: forbiddenDecisionBody,
      rejected: rejectBody,
    },
  );

  const lastPeriod = previousPeriodCode(currentPeriod);
  const lockRes = await sendAs(
    approverToken,
    command("lock-period", { periodCode: lastPeriod }, `smoke-${randomUUID()}`),
  );
  const lockBody = (await lockRes.json()) as CommandResult;
  const lateEntryId = randomUUID();
  const lateRes = await sendAs(
    submitterToken,
    command(
      "record-expense",
      expensePayload(lateEntryId, 40_000, `${lastPeriod}-15`),
      `smoke-${randomUUID()}`,
    ),
  );
  const lateBody = (await lateRes.json()) as CommandResult;
  if (lockBody.rowVersion === undefined) {
    throw new Error("lock-period response did not include rowVersion");
  }
  const reopenRes = await sendAs(
    adminToken,
    command(
      "reopen-period",
      { periodCode: lastPeriod, reason: "smoke reopen" },
      `smoke-${randomUUID()}`,
      { expectedVersion: lockBody.rowVersion },
    ),
  );
  const reopenBody = (await reopenRes.json()) as CommandResult;
  check(
    "period lock + late posting",
    lockRes.status === 200 &&
      lateRes.status === 200 &&
      lateBody.warnings?.includes("LATE_POSTING") === true &&
      reopenRes.status === 200,
    { locked: lockBody, late: lateBody, reopened: reopenBody },
  );

  const reversalEntryId = randomUUID();
  const reversalRes = await sendAs(
    approverToken,
    command(
      "reverse-entry",
      {
        reversalEntryId,
        originalEntryId: belowThresholdEntryId,
        reason: "smoke reversal",
      },
      `smoke-${randomUUID()}`,
      { expectedVersion: 1 },
    ),
  );
  const reversalBody = (await reversalRes.json()) as CommandResult;
  const reversalPostings = await authDb
    .select({ amountMinor: financialPostings.amountMinor })
    .from(financialPostings)
    .where(
      and(
        eq(financialPostings.workspaceId, workspace.id),
        inArray(financialPostings.financialEntryId, [
          belowThresholdEntryId,
          reversalEntryId,
        ]),
      ),
    );
  const reversalNet = reversalPostings.reduce(
    (sum, posting) => sum + posting.amountMinor,
    0n,
  );
  check(
    "reversal nets to zero",
    reversalRes.status === 200 && reversalNet === 0n,
    {
      response: reversalBody,
      amounts: reversalPostings.map((posting) => posting.amountMinor.toString()),
      net: reversalNet.toString(),
    },
  );

  const revenueEntryId = randomUUID();
  const revenueRes = await sendAs(
    approverToken,
    command(
      "record-revenue",
      {
        entryId: revenueEntryId,
        branchCode: branch.code,
        categoryCode: "FREIGHT_REVENUE",
        economicDate: currentEconomicDate,
        amountMinor: 25_000,
        paymentMethod: "MOMO",
        paymentReference: "smoke-momo-25000",
        postings: [{ amountMinor: 25_000 }],
      },
      `smoke-${randomUUID()}`,
    ),
  );
  const revenueBody = (await revenueRes.json()) as CommandResult;
  check(
    "record-revenue posts",
    revenueRes.status === 200 &&
      revenueBody.recordStatus === "POSTED" &&
      revenueBody.warnings?.length === 0,
    revenueBody,
  );

  console.log(failures === 0 ? "\nSMOKE OK" : `\nSMOKE FAILED (${failures})`);
} finally {
  await app.close();
  await pool.end();
  await authPool.end();
}
process.exitCode = failures === 0 ? 0 : 1;

interface CommandResult {
  recordStatus?: string;
  rowVersion?: number;
  warnings?: string[];
  error?: { code?: string };
}

function periodCodeFor(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Douala",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) throw new Error("could not resolve current period");
  return `${year}-${month}`;
}

function previousPeriodCode(periodCode: string): string {
  const [yearText, monthText] = periodCode.split("-");
  const previous = new Date(Date.UTC(Number(yearText), Number(monthText) - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}
