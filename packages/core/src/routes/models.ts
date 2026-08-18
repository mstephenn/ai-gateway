import type { FastifyInstance, FastifyReply } from "fastify";

import { authenticate } from "../auth/authenticate.js";
import type { DbClient } from "../db/client.js";
import { statusForError, UnauthorizedError } from "../errors.js";
import type { Provider } from "../types/provider.js";

export interface ModelsRouteDeps {
  db: DbClient;
  providers: Map<string, Provider>;
}

interface ModelEntry {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  const status = statusForError(err);
  return reply
    .status(status)
    .send({ error: err instanceof Error ? err.message : "internal_error" });
}

export function registerModelsRoute(
  app: FastifyInstance,
  deps: ModelsRouteDeps,
): void {
  app.get("/v1/models", async (request, reply) => {
    const authHeader = request.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : undefined;

    const auth = await authenticate(deps.db, bearerToken);
    if (!auth) {
      return sendError(reply, new UnauthorizedError("invalid_api_key"));
    }

    const rows = await deps.db.deployment.findMany({
      where: {
        isActive: true,
        provider: { in: Array.from(deps.providers.keys()) },
      },
      select: { modelName: true },
      distinct: ["modelName"],
    });

    const data: ModelEntry[] = rows.map((row) => ({
      id: row.modelName,
      object: "model",
      created: 0,
      owned_by: "ai-gateway",
    }));

    return reply.status(200).send({ object: "list", data });
  });
}
