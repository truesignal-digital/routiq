import type { CommandSubmission, RegisterAssetPayload } from "@routiq/contracts";
import type { CommandClient } from "@/commands/client.js";
import type { ImportPayload, RowVerdict } from "./model.js";

type ReadyRow = Extract<RowVerdict, { status: "ready" }>;

/** What the server said to one row. */
export type SendResult =
  | { line: number; status: "created"; assetId: string; assetCode: string; replay: boolean }
  | { line: number; status: "approval"; assetCode: string }
  | { line: number; status: "failed"; assetCode: string; code: string };

/**
 * The envelope is a pure function of the workspace and the row's content: the
 * same row sent again carries the same command id, idempotency key and asset
 * id, so the server replays its first answer instead of registering twice.
 * Command and asset ids are global primary keys, hence the workspace in the seed.
 */
export async function importSubmission(
  workspaceId: string,
  payload: ImportPayload,
): Promise<CommandSubmission<RegisterAssetPayload>> {
  const seed = `${workspaceId}\n${canonicalJson(payload)}`;
  const [commandId, assetId, key] = await Promise.all([
    hashUuid(`command\n${seed}`),
    hashUuid(`asset\n${seed}`),
    sha256Hex(`key\n${seed}`),
  ]);
  return {
    name: "register-asset",
    version: 2,
    payload: { ...payload, assetId },
    envelope: {
      commandId,
      idempotencyKey: `csv-import:${key.slice(0, 48)}`,
      origin: "CSV_IMPORT",
      sourceArtifactIds: [],
    },
  };
}

/**
 * One `register-asset` per ready row, one at a time, through the same client
 * and named route the form writes through. A row that fails does not stop the
 * rest: what succeeded stays, and the fixed file can be sent again.
 */
export async function sendImport(
  client: CommandClient,
  workspaceId: string,
  rows: readonly ReadyRow[],
  onResult: (result: SendResult, done: number) => void = () => {},
): Promise<SendResult[]> {
  const results: SendResult[] = [];
  for (const row of rows) {
    const submission = await importSubmission(workspaceId, row.payload);
    const reply = await client.submit(submission);
    const assetCode = row.payload.assetCode;
    const result: SendResult = reply.ok
      ? reply.outcome.recordStatus === "PENDING_APPROVAL"
        ? { line: row.line, status: "approval", assetCode }
        : {
            line: row.line,
            status: "created",
            assetId: reply.outcome.recordId,
            assetCode,
            replay: reply.outcome.idempotentReplay,
          }
      : reply.code === "APPROVAL_REQUIRED"
        ? { line: row.line, status: "approval", assetCode }
        : { line: row.line, status: "failed", assetCode, code: reply.code };
    results.push(result);
    onResult(result, results.length);
  }
  return results;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter((entry) => entry[1] !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

async function sha256Hex(text: string): Promise<string> {
  return [...(await sha256(text))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** RFC 9562 name-based layout (version 5 bits, RFC variant) over a SHA-256 digest. */
async function hashUuid(text: string): Promise<string> {
  const bytes = (await sha256(text)).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
