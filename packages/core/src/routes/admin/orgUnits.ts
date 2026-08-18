import type {
  CreateOrgUnitRequest,
  OrgUnitType,
  UpdateOrgUnitRequest,
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

export interface AdminOrgUnitsRouteDeps {
  db: DbClient;
}

const ORG_UNIT_TYPES = [
  "root",
  "business_unit",
  "department",
  "cost_center",
  "project",
  "team",
] as const;
type CreateOrgUnitBody = Partial<CreateOrgUnitRequest>;
type UpdateOrgUnitBody = UpdateOrgUnitRequest;

interface OrgUnitNode {
  id: string;
  organizationId: string;
  type: string;
  name: string;
  parentId: string | null;
  teamId: string | null;
  externalId: string | null;
  createdAt: Date;
  updatedAt: Date;
  children?: OrgUnitNode[];
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

function isValidType(value: string): value is OrgUnitType {
  return ORG_UNIT_TYPES.includes(value as OrgUnitType);
}

function buildTree(nodes: OrgUnitNode[]): OrgUnitNode[] {
  const map = new Map<string, OrgUnitNode>();
  const roots: OrgUnitNode[] = [];

  for (const node of nodes) {
    map.set(node.id, { ...node, children: [] });
  }

  for (const node of map.values()) {
    if (node.parentId) {
      const parent = map.get(node.parentId);
      if (parent) {
        parent.children!.push(node);
      } else {
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export function registerAdminOrgUnitsRoute(
  app: FastifyInstance,
  deps: AdminOrgUnitsRouteDeps,
): void {
  app.get("/admin/org-units", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const query = request.query as { format?: string };
      const asTree = query.format === "tree";

      const org = await deps.db.organization.findFirst();
      if (!org) {
        return reply.status(200).send({ object: "list", data: [] });
      }

      const nodes = (await deps.db.orgUnit.findMany({
        where: { organizationId: org.id },
        orderBy: { name: "asc" },
      })) as OrgUnitNode[];

      const data = asTree ? buildTree(nodes) : nodes;

      return reply
        .status(200)
        .send({ object: "list", format: asTree ? "tree" : "flat", data });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/admin/org-units", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const body = request.body as CreateOrgUnitBody;

      if (!body.organizationId || typeof body.organizationId !== "string") {
        return sendError(
          reply,
          new ValidationError("organizationId is required"),
        );
      }
      if (!body.type || !isValidType(body.type)) {
        return sendError(
          reply,
          new ValidationError(
            "type must be one of root, business_unit, department, cost_center, project, team",
          ),
        );
      }
      if (
        !body.name ||
        typeof body.name !== "string" ||
        body.name.length === 0
      ) {
        return sendError(reply, new ValidationError("name is required"));
      }

      const organization = await deps.db.organization.findUnique({
        where: { id: body.organizationId },
      });
      if (!organization) {
        return reply.status(400).send({ error: "organization not found" });
      }

      if (body.type === "root") {
        if (body.parentId) {
          return sendError(
            reply,
            new ValidationError("root org unit cannot have a parent"),
          );
        }
        const existingRoot = await deps.db.orgUnit.findFirst({
          where: { organizationId: body.organizationId, type: "root" },
        });
        if (existingRoot) {
          return reply
            .status(409)
            .send({ error: "root org unit already exists" });
        }
      }

      if (body.parentId) {
        const parent = await deps.db.orgUnit.findUnique({
          where: { id: body.parentId },
        });
        if (!parent) {
          return reply.status(400).send({ error: "parent org unit not found" });
        }
        if (parent.organizationId !== body.organizationId) {
          return reply
            .status(400)
            .send({ error: "parent belongs to a different organization" });
        }
      }

      if (body.type === "team") {
        if (!body.teamId) {
          return sendError(
            reply,
            new ValidationError("teamId is required for team org units"),
          );
        }
        const team = await deps.db.team.findUnique({
          where: { id: body.teamId },
        });
        if (!team) {
          return reply.status(400).send({ error: "team not found" });
        }
      } else if (body.teamId) {
        return sendError(
          reply,
          new ValidationError("teamId is only allowed for team org units"),
        );
      }

      const unit = await deps.db.orgUnit.create({
        data: {
          organizationId: body.organizationId,
          type: body.type,
          name: body.name,
          parentId: body.parentId ?? null,
          teamId: body.teamId ?? null,
        },
      });

      return reply.status(201).send(unit);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/admin/org-units/:id", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const { id } = request.params as { id: string };
      const unit = await deps.db.orgUnit.findUnique({
        where: { id },
        include: { parent: true, team: true, organization: true },
      });

      if (!unit) {
        return reply.status(404).send({ error: "org unit not found" });
      }

      return reply.status(200).send(unit);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch("/admin/org-units/:id", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const { id } = request.params as { id: string };
      const existing = await deps.db.orgUnit.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ error: "org unit not found" });
      }

      const body = request.body as UpdateOrgUnitBody;
      const data: {
        name?: string;
        parentId?: string | null;
        teamId?: string | null;
      } = {};

      if (body.name !== undefined) {
        if (typeof body.name !== "string" || body.name.length === 0) {
          return sendError(
            reply,
            new ValidationError("name must be a non-empty string"),
          );
        }
        data.name = body.name;
      }

      if (body.parentId !== undefined) {
        if (body.parentId === id) {
          return sendError(
            reply,
            new ValidationError("an org unit cannot be its own parent"),
          );
        }
        if (body.parentId === null) {
          if (existing.type === "root") {
            data.parentId = null;
          } else {
            return sendError(
              reply,
              new ValidationError("only root org units can have no parent"),
            );
          }
        } else {
          const parent = await deps.db.orgUnit.findUnique({
            where: { id: body.parentId },
          });
          if (!parent) {
            return reply
              .status(400)
              .send({ error: "parent org unit not found" });
          }
          if (parent.organizationId !== existing.organizationId) {
            return reply
              .status(400)
              .send({ error: "parent belongs to a different organization" });
          }
          data.parentId = body.parentId;
        }
      }

      if (body.teamId !== undefined) {
        if (existing.type === "team") {
          if (body.teamId) {
            const team = await deps.db.team.findUnique({
              where: { id: body.teamId },
            });
            if (!team) {
              return reply.status(400).send({ error: "team not found" });
            }
          }
          data.teamId = body.teamId ?? null;
        } else if (body.teamId) {
          return sendError(
            reply,
            new ValidationError("teamId is only allowed for team org units"),
          );
        }
      }

      const updated = await deps.db.orgUnit.update({ where: { id }, data });
      return reply.status(200).send(updated);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.delete("/admin/org-units/:id", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const { id } = request.params as { id: string };
      const existing = await deps.db.orgUnit.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ error: "org unit not found" });
      }

      const childrenCount = await deps.db.orgUnit.count({
        where: { parentId: id },
      });
      if (childrenCount > 0) {
        return reply.status(409).send({ error: "org unit has child units" });
      }

      const membershipsCount = await deps.db.membership.count({
        where: { orgUnitId: id },
      });
      if (membershipsCount > 0) {
        return reply.status(409).send({ error: "org unit has memberships" });
      }

      await deps.db.orgUnit.delete({ where: { id } });
      return reply.status(204).send();
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
