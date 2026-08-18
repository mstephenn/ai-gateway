import type { CreateUserRequest, UpdateUserRequest } from "@ai-gateway/shared";
import type { FastifyInstance, FastifyReply } from "fastify";

import { authenticate } from "../../auth/authenticate.js";
import type { DbClient } from "../../db/client.js";
import {
  ForbiddenError,
  statusForError,
  UnauthorizedError,
  ValidationError,
} from "../../errors.js";

export interface AdminUsersRouteDeps {
  db: DbClient;
}

const USER_STATUSES = ["active", "inactive"] as const;
const USER_SOURCES = ["manual", "directory", "linked"] as const;

type CreateUserBody = Partial<CreateUserRequest>;
type UpdateUserBody = UpdateUserRequest;

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

function isValidStatus(value: string): value is (typeof USER_STATUSES)[number] {
  return (USER_STATUSES as readonly string[]).includes(value);
}

function isValidSource(value: string): value is (typeof USER_SOURCES)[number] {
  return (USER_SOURCES as readonly string[]).includes(value);
}

export function registerAdminUsersRoute(
  app: FastifyInstance,
  deps: AdminUsersRouteDeps,
): void {
  app.get("/admin/users", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const query = request.query as {
        status?: string;
        source?: string;
        organizationId?: string;
      };
      const where: any = {};
      if (query.status && isValidStatus(query.status)) {
        where.status = query.status;
      }
      if (query.source && isValidSource(query.source)) {
        where.source = query.source;
      }
      if (query.organizationId) {
        where.organizationId = query.organizationId;
      }

      const users = await deps.db.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
      });

      return reply.status(200).send({ object: "list", data: users });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/admin/users", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const body = request.body as CreateUserBody;
      if (
        !body.email ||
        typeof body.email !== "string" ||
        body.email.length === 0
      ) {
        return sendError(reply, new ValidationError("email is required"));
      }

      const existing = await deps.db.user.findUnique({
        where: { email: body.email },
      });
      if (existing) {
        return reply
          .status(409)
          .send({ error: "user with this email already exists" });
      }

      if (body.organizationId) {
        const org = await deps.db.organization.findUnique({
          where: { id: body.organizationId },
        });
        if (!org) {
          return reply.status(400).send({ error: "organization not found" });
        }
      }

      const source =
        body.source && isValidSource(body.source) ? body.source : "manual";

      const user = await deps.db.user.create({
        data: {
          email: body.email,
          name: body.name ?? null,
          organizationId: body.organizationId ?? null,
          source,
          externalId: body.externalId ?? null,
        },
      });

      return reply.status(201).send(user);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/admin/users/:id", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const { id } = request.params as { id: string };
      const user = await deps.db.user.findUnique({
        where: { id },
        include: { memberships: { include: { orgUnit: true, role: true } } },
      });

      if (!user) {
        return reply.status(404).send({ error: "user not found" });
      }

      return reply.status(200).send(user);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch("/admin/users/:id", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const { id } = request.params as { id: string };
      const existing = await deps.db.user.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ error: "user not found" });
      }

      const body = request.body as UpdateUserBody;
      const data: any = {};

      if (body.name !== undefined) {
        data.name = body.name ?? null;
      }
      if (body.email !== undefined) {
        if (typeof body.email !== "string" || body.email.length === 0) {
          return sendError(
            reply,
            new ValidationError("email must be a non-empty string"),
          );
        }
        data.email = body.email;
      }
      if (body.status !== undefined) {
        if (!isValidStatus(body.status)) {
          return sendError(
            reply,
            new ValidationError("status must be active or inactive"),
          );
        }
        data.status = body.status;
      }
      if (body.source !== undefined) {
        if (!isValidSource(body.source)) {
          return sendError(
            reply,
            new ValidationError("source must be manual, directory, or linked"),
          );
        }
        data.source = body.source;
      }
      if (body.externalId !== undefined) {
        data.externalId = body.externalId ?? null;
      }

      const updated = await deps.db.user.update({ where: { id }, data });
      return reply.status(200).send(updated);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/admin/users/:id/deactivate", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const { id } = request.params as { id: string };
      const existing = await deps.db.user.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ error: "user not found" });
      }

      const updated = await deps.db.user.update({
        where: { id },
        data: { status: "inactive" },
      });
      return reply.status(200).send(updated);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/admin/users/:id/reactivate", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const { id } = request.params as { id: string };
      const existing = await deps.db.user.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ error: "user not found" });
      }

      const updated = await deps.db.user.update({
        where: { id },
        data: { status: "active" },
      });
      return reply.status(200).send(updated);
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
