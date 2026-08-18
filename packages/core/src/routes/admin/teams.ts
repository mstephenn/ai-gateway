import type { CreateTeamRequest, UpdateTeamRequest } from "@ai-gateway/shared";
import type { FastifyInstance, FastifyReply } from "fastify";

import { authenticate } from "../../auth/authenticate.js";
import type { DbClient } from "../../db/client.js";
import {
  ForbiddenError,
  statusForError,
  UnauthorizedError,
  ValidationError,
} from "../../errors.js";

export interface AdminTeamsRouteDeps {
  db: DbClient;
}

type CreateTeamBody = Partial<CreateTeamRequest>;
type UpdateTeamBody = UpdateTeamRequest;

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

export function registerAdminTeamsRoute(
  app: FastifyInstance,
  deps: AdminTeamsRouteDeps,
): void {
  app.post("/admin/teams", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const body = request.body as CreateTeamBody;
      if (!body.name || typeof body.name !== "string") {
        return sendError(reply, new ValidationError("name is required"));
      }

      const team = await deps.db.team.create({
        data: {
          name: body.name,
          budgetLimit: body.budgetLimit ?? null,
          allowedModels: body.allowedModels ?? [],
        },
      });

      return reply.status(201).send(team);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/admin/teams", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const teams = await deps.db.team.findMany({
        orderBy: { createdAt: "desc" },
      });
      return reply.status(200).send({ object: "list", data: teams });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/admin/teams/:id", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const { id } = request.params as { id: string };
      const team = await deps.db.team.findUnique({ where: { id } });
      if (!team) {
        return reply.status(404).send({ error: "team not found" });
      }

      return reply.status(200).send(team);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch("/admin/teams/:id", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const { id } = request.params as { id: string };
      const existing = await deps.db.team.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ error: "team not found" });
      }

      const body = request.body as UpdateTeamBody;
      const data: any = {};
      if (body.name !== undefined) {
        if (typeof body.name !== "string" || body.name.length === 0) {
          return sendError(
            reply,
            new ValidationError("name must be a non-empty string"),
          );
        }
        data.name = body.name;
      }
      if (body.budgetLimit !== undefined) {
        data.budgetLimit = body.budgetLimit;
      }
      if (body.allowedModels !== undefined) {
        data.allowedModels = body.allowedModels;
      }

      const team = await deps.db.team.update({ where: { id }, data });
      return reply.status(200).send(team);
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
