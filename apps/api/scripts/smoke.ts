/**
 * Hands-on smoke of the spine against the local compose Postgres.
 * Prereqs: `docker compose up -d` and `pnpm db:migrate`.
 * Run: pnpm --filter @asset/api exec tsx scripts/smoke.ts
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db, pool } from "../src/db/client.js";
import { buildServer } from "../src/server.js";
import { seedMember, seedWorkspace } from "../src/test/seed.js";

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  → ${JSON.stringify(detail)}`}`);
  if (!ok) failures += 1;
}

const app = buildServer({ db, logger: false });
await app.listen({ port: PORT, host: "127.0.0.1" });

try {
  const slug = `smoke-${Date.now()}`;
  const { workspace, branch } = await seedWorkspace(db, slug);
  await seedMember(db, {
    workspaceId: workspace.id,
    role: "ADMIN",
    allBranches: true,
    username: "smoke-admin",
    pin: "4821",
  });
  console.log(`workspace ${slug} (branch ${branch.code}) seeded\n`);

  const loginRes = await fetch(`${BASE}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceSlug: slug, username: "smoke-admin", pin: "4821" }),
  });
  const { token } = (await loginRes.json()) as { token: string };
  check("login issues a token", loginRes.status === 200 && typeof token === "string");

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

  const authed = (path: string, body?: unknown) =>
    fetch(`${BASE}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const me = await (await authed("/v1/me")).json();
  check(
    "/v1/me resolves server-side context",
    (me as { workspaceId: string; role: string }).workspaceId === workspace.id &&
      (me as { role: string }).role === "ADMIN",
    me,
  );

  const command = (name: string, payload: unknown, key: string, commandId = randomUUID()) => ({
    name,
    version: 1,
    envelope: { commandId, idempotencyKey: key, origin: "HUMAN_UI" },
    payload,
  });
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
  const r1 = await authed("/v1/commands", first);
  const r1b = (await r1.json()) as { recordId: string; idempotentReplay: boolean };
  check("register-asset commits", r1.status === 200 && r1b.recordId === assetId, r1b);

  const r2 = await authed("/v1/commands", first);
  const r2b = (await r2.json()) as { recordId: string; idempotentReplay: boolean };
  check(
    "exact retry replays original outcome",
    r2.status === 200 && r2b.idempotentReplay === true && r2b.recordId === assetId,
    r2b,
  );

  const r3 = await authed(
    "/v1/commands",
    command("register-asset", assetPayload(randomUUID(), "SMOKE-002"), key),
  );
  check("same key + new payload → 409", r3.status === 409, await r3.json());

  const r4 = await authed(
    "/v1/commands",
    command("disable-module", { moduleCode: "ASSETS" }, `smoke-${randomUUID()}`),
  );
  check("disable-module ASSETS", r4.status === 200, await r4.json());

  const r5 = await authed(
    "/v1/commands",
    command("register-asset", assetPayload(randomUUID(), "SMOKE-003"), `smoke-${randomUUID()}`),
  );
  const r5b = (await r5.json()) as { error?: { code: string } };
  check("register while disabled → MODULE_DISABLED", r5.status === 403 && r5b.error?.code === "MODULE_DISABLED", r5b);

  const r6 = await authed(
    "/v1/commands",
    command("enable-module", { moduleCode: "ASSETS" }, `smoke-${randomUUID()}`),
  );
  check("enable-module ASSETS", r6.status === 200, await r6.json());

  const r7 = await authed(
    "/v1/commands",
    command("register-asset", assetPayload(randomUUID(), "SMOKE-004"), `smoke-${randomUUID()}`),
  );
  check("register works again", r7.status === 200, await r7.json());

  console.log(failures === 0 ? "\nSMOKE OK" : `\nSMOKE FAILED (${failures})`);
} finally {
  await app.close();
  await pool.end();
}
process.exitCode = failures === 0 ? 0 : 1;
