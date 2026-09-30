import { randomUUID } from "node:crypto";
import type { PrincipalType, Role } from "@routiq/contracts";
import type { FastifyInstance } from "fastify";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { seedMember } from "./seed.js";

export interface CommandReply {
  status: number;
  body: {
    commandId?: string;
    recordId?: string;
    rowVersion?: number;
    recordStatus?: string;
    warnings?: string[];
    idempotentReplay?: boolean;
    error?: { code: string; metadata?: Record<string, unknown> };
  };
}

export interface CommandSuccess {
  commandId: string;
  recordId: string;
  rowVersion: number;
  recordStatus?: string;
  warnings: string[];
  idempotentReplay: boolean;
}

export interface Actor {
  token: string;
  principalId: string;
  membershipId: string;
  displayName: string;
}

/** A member with a live session, for suites that act as several roles. */
export async function seedActor(
  db: Db,
  opts: {
    workspaceId: string;
    role: Role;
    allBranches?: boolean;
    branchIds?: string[];
    principalType?: PrincipalType;
    displayName?: string;
  },
): Promise<Actor> {
  const { principal, membership } = await seedMember(db, {
    workspaceId: opts.workspaceId,
    role: opts.role,
    allBranches: opts.allBranches ?? (opts.branchIds === undefined),
    ...(opts.branchIds === undefined ? {} : { branchIds: opts.branchIds }),
    ...(opts.principalType === undefined ? {} : { principalType: opts.principalType }),
    username: opts.displayName ?? `${opts.role.toLowerCase()}-${randomUUID().slice(0, 6)}`,
  });
  const { token } = await createSession(db, {
    principalId: principal.id,
    workspaceId: opts.workspaceId,
  });
  return {
    token,
    principalId: principal.id,
    membershipId: membership.id,
    displayName: principal.displayName,
  };
}

/** Named-route command calls and plain GETs against an injected app. */
export function apiClient(app: FastifyInstance) {
  async function send(
    token: string,
    name: string,
    payload: Record<string, unknown>,
    envelope: Record<string, unknown> = {},
    version = 1,
  ): Promise<CommandReply> {
    const response = await app.inject({
      method: "POST",
      url: `/v1/commands/${name}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `test-${randomUUID()}`,
          origin: "HUMAN_UI",
          ...envelope,
        },
        payload,
      },
    });
    return { status: response.statusCode, body: response.json() as CommandReply["body"] };
  }

  async function ok(
    token: string,
    name: string,
    payload: Record<string, unknown>,
    envelope: Record<string, unknown> = {},
    version = 1,
  ): Promise<CommandSuccess> {
    const reply = await send(token, name, payload, envelope, version);
    if (reply.status !== 200) {
      throw new Error(`${name} failed: ${reply.status} ${JSON.stringify(reply.body)}`);
    }
    return reply.body as CommandSuccess;
  }

  async function get(token: string, url: string): Promise<{ status: number; body: unknown }> {
    const response = await app.inject({
      method: "GET",
      url,
      headers: { authorization: `Bearer ${token}` },
    });
    return { status: response.statusCode, body: response.json() as unknown };
  }

  return { send, ok, get };
}
