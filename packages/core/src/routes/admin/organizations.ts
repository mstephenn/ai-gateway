import type {
  CreateOrganizationRequest,
  UpdateOrganizationRequest,
} from "@ai-gateway/shared";
import type { FastifyInstance, FastifyReply } from "fastify";

import { authenticate } from "../../auth/authenticate.js";
import type { DbClient } from "../../db/client.js";
import {
  ForbiddenError,
  statusForError,
  UnauthorizedError,
  ValidationError,
} from "../../errors.js";

export interface AdminOrganizationsRouteDeps {
  db: DbClient;
}

type CreateOrganizationBody = Partial<CreateOrganizationRequest>;
type UpdateOrganizationBody = UpdateOrganizationRequest;

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

export function registerAdminOrganizationsRoute(
  app: FastifyInstance,
  deps: AdminOrganizationsRouteDeps,
): void {
  app.get("/admin/organization", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const org = await deps.db.organization.findFirst();
      if (!org) {
        return reply.status(404).send({ error: "organization not found" });
      }

      return reply.status(200).send(org);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/admin/organization", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const existing = await deps.db.organization.findFirst();
      if (existing) {
        return reply.status(409).send({ error: "organization already exists" });
      }

      const body = request.body as CreateOrganizationBody;
      if (
        !body.name ||
        typeof body.name !== "string" ||
        body.name.length === 0
      ) {
        return sendError(reply, new ValidationError("name is required"));
      }

      const org = await deps.db.organization.create({
        data: {
          name: body.name,
          domain: body.domain ?? null,
        },
      });

      return reply.status(201).send(org);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch("/admin/organization", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const org = await deps.db.organization.findFirst();
      if (!org) {
        return reply.status(404).send({ error: "organization not found" });
      }

      const body = request.body as UpdateOrganizationBody;
      const data: { name?: string; domain?: string | null } = {};

      if (body.name !== undefined) {
        if (typeof body.name !== "string" || body.name.length === 0) {
          return sendError(
            reply,
            new ValidationError("name must be a non-empty string"),
          );
        }
        data.name = body.name;
      }
      if (body.domain !== undefined) {
        data.domain = body.domain ?? null;
      }

      const updated = await deps.db.organization.update({
        where: { id: org.id },
        data,
      });

      return reply.status(200).send(updated);
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
