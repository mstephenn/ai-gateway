import type {
  CreateGuardrailRuleRequest,
  UpdateGuardrailRuleRequest,
} from "@ai-gateway/shared";
import type { FastifyInstance, FastifyReply } from "fastify";

import { authenticate } from "../../auth/authenticate.js";
import type { DbClient } from "../../db/client.js";
import type { GuardrailRuleType, Prisma } from "../../db/generated/client.js";
import {
  ForbiddenError,
  statusForError,
  UnauthorizedError,
  ValidationError,
} from "../../errors.js";

export interface AdminGuardrailsRouteDeps {
  db: DbClient;
}

type CreateGuardrailBody = Partial<CreateGuardrailRuleRequest>;
type UpdateGuardrailBody = UpdateGuardrailRuleRequest;

const VALID_TYPES: GuardrailRuleType[] = [
  "keyword_block",
  "pii_mask",
  "moderation",
];

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

function validateType(type: unknown): GuardrailRuleType {
  if (
    typeof type !== "string" ||
    !VALID_TYPES.includes(type as GuardrailRuleType)
  ) {
    throw new ValidationError(`type must be one of: ${VALID_TYPES.join(", ")}`);
  }
  return type as GuardrailRuleType;
}

export function registerAdminGuardrailsRoute(
  app: FastifyInstance,
  deps: AdminGuardrailsRouteDeps,
): void {
  app.post("/admin/guardrails", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const body = request.body as CreateGuardrailBody;
      if (!body.name || typeof body.name !== "string") {
        return sendError(reply, new ValidationError("name is required"));
      }
      const type = validateType(body.type);

      const rule = await deps.db.guardrailRule.create({
        data: {
          name: body.name,
          type,
          enabled: body.enabled ?? true,
          config: body.config ?? {},
        },
      });

      return reply.status(201).send(rule);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/admin/guardrails", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const rules = await deps.db.guardrailRule.findMany({
        orderBy: { createdAt: "desc" },
      });
      return reply.status(200).send({ object: "list", data: rules });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/admin/guardrails/:id", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const { id } = request.params as { id: string };
      const rule = await deps.db.guardrailRule.findUnique({ where: { id } });
      if (!rule) {
        return reply.status(404).send({ error: "guardrail rule not found" });
      }

      return reply.status(200).send(rule);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch("/admin/guardrails/:id", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const { id } = request.params as { id: string };
      const existing = await deps.db.guardrailRule.findUnique({
        where: { id },
      });
      if (!existing) {
        return reply.status(404).send({ error: "guardrail rule not found" });
      }

      const body = request.body as UpdateGuardrailBody;
      const data: Prisma.GuardrailRuleUpdateInput = {};
      if (body.name !== undefined) {
        if (typeof body.name !== "string" || body.name.length === 0) {
          return sendError(
            reply,
            new ValidationError("name must be a non-empty string"),
          );
        }
        data.name = body.name;
      }
      if (body.enabled !== undefined) {
        data.enabled = body.enabled;
      }
      if (body.config !== undefined) {
        data.config = body.config as Prisma.InputJsonValue;
      }

      const rule = await deps.db.guardrailRule.update({ where: { id }, data });
      return reply.status(200).send(rule);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.delete("/admin/guardrails/:id", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const { id } = request.params as { id: string };
      await deps.db.guardrailRule.delete({ where: { id } });
      return reply.status(204).send();
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
