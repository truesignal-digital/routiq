import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { Db } from "../db/client.js";
import type { ObjectStorage } from "../storage/types.js";

/** STUB (ticket 09): presign + finalize routes land here. */
export function registerArtifactRoutes(
  _app: FastifyInstance,
  _db: Db,
  _storage: ObjectStorage,
  _requireAuth: preHandlerHookHandler,
): void {}
