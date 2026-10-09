import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveAccount } from "./accounts.js";
import { newRunDir, requireState } from "./stack.js";

function readBody(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const text = raw.startsWith("@") ? readFileSync(path.resolve(process.env["INIT_CWD"] ?? process.cwd(), raw.slice(1)), "utf8") : raw;
  JSON.parse(text);
  return text;
}

/** Calls the slot API as a seeded account. Prints status and JSON; never prints the token. */
export async function callApi(slot: number, method: string, route: string, role: string, rawBody: string | undefined): Promise<boolean> {
  const state = requireState(slot);
  const account = resolveAccount(role);
  const body = readBody(rawBody);
  const login = await fetch(`${state.urls.api}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceSlug: account.workspace, username: account.username, pin: account.pin }),
  });
  const session = (await login.json()) as { token?: string };
  if (login.status !== 200 || session.token === undefined) throw new Error(`login as ${account.username} failed with ${login.status}`);

  const res = await fetch(`${state.urls.api}${route}`, {
    method,
    headers: { authorization: `Bearer ${session.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body }),
  });
  const text = await res.text();
  let pretty = text;
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // not JSON; print as is
  }
  const dir = newRunDir("api", slot);
  const file = path.join(dir, "response.json");
  writeFileSync(
    path.join(dir, "request.json"),
    `${JSON.stringify({ method, route, as: account.username, role: account.role, body: body === undefined ? null : JSON.parse(body) }, null, 2)}\n`,
  );
  writeFileSync(file, `${pretty}\n`);
  process.stdout.write(`${method} ${route} as ${account.username} (${account.role}) → ${res.status}\n${pretty}\n`);
  process.stdout.write(`saved: ${file}\n`);
  return res.ok;
}
