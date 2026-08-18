import type { FastifyInstance, FastifyReply } from "fastify";

import { authenticate } from "../../auth/authenticate.js";
import type { DbClient } from "../../db/client.js";
import {
  ForbiddenError,
  statusForError,
  UnauthorizedError,
} from "../../errors.js";

export interface AdminRolesRouteDeps {
  db: DbClient;
}

function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  const status = statusForError(err);
  return reply
    .status(status)
    .send({ error: err instanceof Error ? err.message : "internal_error" });
}

function extractBearerToken(request: {
  headers: { authorization?: string };
}): string | undefined {
  const authHeader = request.headers.authorization;
  return authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : undefined;
}

export function registerAdminRolesRoute(
  app: FastifyInstance,
  deps: AdminRolesRouteDeps,
): void {
  app.get("/admin/roles", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const roles = await deps.db.role.findMany({ orderBy: { name: "asc" } });
      return reply.status(200).send({ object: "list", data: roles });
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
