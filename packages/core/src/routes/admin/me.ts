import type { FastifyInstance, FastifyReply } from "fastify";

import { authenticate } from "../../auth/authenticate.js";
import type { DbClient } from "../../db/client.js";
import { statusForError, UnauthorizedError } from "../../errors.js";

export interface AdminMeRouteDeps {
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

export function registerAdminMeRoute(
  app: FastifyInstance,
  deps: AdminMeRouteDeps,
): void {
  app.get("/admin/me", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }

      return reply.status(200).send({
        apiKeyId: auth.apiKeyId,
        isAdmin: auth.isAdmin,
        teamId: auth.teamId ?? null,
        allowedModels: auth.allowedModels ?? [],
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
