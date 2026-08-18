import type { CreateMembershipRequest } from "@ai-gateway/shared";
import type { FastifyInstance, FastifyReply } from "fastify";

import { authenticate } from "../../auth/authenticate.js";
import type { DbClient } from "../../db/client.js";
import {
  ForbiddenError,
  statusForError,
  UnauthorizedError,
  ValidationError,
} from "../../errors.js";

export interface AdminMembershipsRouteDeps {
  db: DbClient;
}

type CreateMembershipBody = Partial<CreateMembershipRequest>;

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

export function registerAdminMembershipsRoute(
  app: FastifyInstance,
  deps: AdminMembershipsRouteDeps,
): void {
  app.get("/admin/memberships", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const query = request.query as { userId?: string; orgUnitId?: string };
      const where: any = {};
      if (query.userId) {
        where.userId = query.userId;
      }
      if (query.orgUnitId) {
        where.orgUnitId = query.orgUnitId;
      }

      const memberships = await deps.db.membership.findMany({
        where,
        include: { user: true, orgUnit: true, role: true },
        orderBy: { createdAt: "desc" },
      });

      return reply.status(200).send({ object: "list", data: memberships });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/admin/memberships", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const body = request.body as CreateMembershipBody;
      if (!body.userId || typeof body.userId !== "string") {
        return sendError(reply, new ValidationError("userId is required"));
      }
      if (!body.orgUnitId || typeof body.orgUnitId !== "string") {
        return sendError(reply, new ValidationError("orgUnitId is required"));
      }
      if (!body.roleId || typeof body.roleId !== "string") {
        return sendError(reply, new ValidationError("roleId is required"));
      }

      const user = await deps.db.user.findUnique({
        where: { id: body.userId },
      });
      if (!user) {
        return reply.status(400).send({ error: "user not found" });
      }

      const orgUnit = await deps.db.orgUnit.findUnique({
        where: { id: body.orgUnitId },
      });
      if (!orgUnit) {
        return reply.status(400).send({ error: "org unit not found" });
      }

      const role = await deps.db.role.findUnique({
        where: { id: body.roleId },
      });
      if (!role) {
        return reply.status(400).send({ error: "role not found" });
      }

      const existing = await deps.db.membership.findUnique({
        where: {
          userId_orgUnitId: { userId: body.userId, orgUnitId: body.orgUnitId },
        },
      });
      if (existing) {
        return reply.status(409).send({
          error: "membership already exists for this user and org unit",
        });
      }

      const membership = await deps.db.membership.create({
        data: {
          userId: body.userId,
          orgUnitId: body.orgUnitId,
          roleId: body.roleId,
        },
        include: { user: true, orgUnit: true, role: true },
      });

      return reply.status(201).send(membership);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.delete("/admin/memberships/:id", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const { id } = request.params as { id: string };
      const existing = await deps.db.membership.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ error: "membership not found" });
      }

      await deps.db.membership.delete({ where: { id } });
      return reply.status(204).send();
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
