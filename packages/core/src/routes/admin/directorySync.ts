import type {
  CreateDirectorySyncConfigRequest,
  UpdateDirectorySyncConfigRequest,
} from "@ai-gateway/shared";
import type { FastifyInstance, FastifyReply } from "fastify";

import { authenticate } from "../../auth/authenticate.js";
import type { DbClient } from "../../db/client.js";
import { createAzureAdProvider } from "../../directorySync/azureAd.js";
import { runSync } from "../../directorySync/runner.js";
import {
  ForbiddenError,
  statusForError,
  UnauthorizedError,
  ValidationError,
} from "../../errors.js";

export interface AdminDirectorySyncRouteDeps {
  db: DbClient;
}

type CreateConfigBody = Partial<CreateDirectorySyncConfigRequest>;
type UpdateConfigBody = UpdateDirectorySyncConfigRequest;

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

function isValidProvider(value: string): value is "azure_ad" {
  return value === "azure_ad";
}

function isValidSyncMode(value: string): value is "preview" | "apply" {
  return value === "preview" || value === "apply";
}

export function registerAdminDirectorySyncRoute(
  app: FastifyInstance,
  deps: AdminDirectorySyncRouteDeps,
): void {
  app.get("/admin/directory-sync/config", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const configs = await deps.db.directorySyncConfig.findMany({
        include: { organization: true },
        orderBy: { createdAt: "desc" },
      });

      return reply.status(200).send({ object: "list", data: configs });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/admin/directory-sync/config", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const body = request.body as CreateConfigBody;
      if (!body.organizationId || typeof body.organizationId !== "string") {
        return sendError(
          reply,
          new ValidationError("organizationId is required"),
        );
      }
      if (!body.provider || !isValidProvider(body.provider)) {
        return sendError(
          reply,
          new ValidationError("provider must be azure_ad"),
        );
      }
      if (!body.tenantId || typeof body.tenantId !== "string") {
        return sendError(reply, new ValidationError("tenantId is required"));
      }
      if (!body.clientId || typeof body.clientId !== "string") {
        return sendError(reply, new ValidationError("clientId is required"));
      }
      if (!body.clientSecretRef || typeof body.clientSecretRef !== "string") {
        return sendError(
          reply,
          new ValidationError("clientSecretRef is required"),
        );
      }
      if (!body.syncMode || !isValidSyncMode(body.syncMode)) {
        return sendError(
          reply,
          new ValidationError("syncMode must be preview or apply"),
        );
      }

      const org = await deps.db.organization.findUnique({
        where: { id: body.organizationId },
      });
      if (!org) {
        return reply.status(400).send({ error: "organization not found" });
      }

      const config = await deps.db.directorySyncConfig.create({
        data: {
          organizationId: body.organizationId,
          provider: body.provider,
          tenantId: body.tenantId,
          clientId: body.clientId,
          clientSecretRef: body.clientSecretRef,
          syncMode: body.syncMode,
          groupMappings: (body.groupMappings ?? {}) as any,
        },
      });

      return reply.status(201).send(config);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch("/admin/directory-sync/config/:id", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const { id } = request.params as { id: string };
      const existing = await deps.db.directorySyncConfig.findUnique({
        where: { id },
      });
      if (!existing) {
        return reply
          .status(404)
          .send({ error: "directory sync config not found" });
      }

      const body = request.body as UpdateConfigBody;
      const data: any = {};
      if (body.tenantId !== undefined) {
        data.tenantId = body.tenantId;
      }
      if (body.clientId !== undefined) {
        data.clientId = body.clientId;
      }
      if (body.clientSecretRef !== undefined) {
        data.clientSecretRef = body.clientSecretRef;
      }
      if (body.syncMode !== undefined) {
        if (!isValidSyncMode(body.syncMode)) {
          return sendError(
            reply,
            new ValidationError("syncMode must be preview or apply"),
          );
        }
        data.syncMode = body.syncMode;
      }
      if (body.groupMappings !== undefined) {
        data.groupMappings = body.groupMappings;
      }

      const updated = await deps.db.directorySyncConfig.update({
        where: { id },
        data,
      });
      return reply.status(200).send(updated);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/admin/directory-sync/config/:id/run", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const { id } = request.params as { id: string };
      const config = await deps.db.directorySyncConfig.findUnique({
        where: { id },
      });
      if (!config) {
        return reply
          .status(404)
          .send({ error: "directory sync config not found" });
      }

      const clientSecret = process.env[config.clientSecretRef];
      if (!clientSecret) {
        return reply
          .status(400)
          .send({ error: "client secret not found in environment" });
      }

      const run = await deps.db.directorySyncRun.create({
        data: {
          configId: config.id,
          status: "running",
          startedAt: new Date(),
        },
      });

      const provider = createAzureAdProvider({
        tenantId: config.tenantId,
        clientId: config.clientId,
        clientSecret,
      });

      const result = await runSync(deps.db, config, provider, {
        apply: config.syncMode === "apply",
      });

      await deps.db.directorySyncRun.update({
        where: { id: run.id },
        data: {
          status: result.status,
          completedAt: new Date(),
          summary: {
            total: result.changes.length,
            create_user: result.changes.filter(
              (c) => c.action === "create_user",
            ).length,
            update_user: result.changes.filter(
              (c) => c.action === "update_user",
            ).length,
            disable_user: result.changes.filter(
              (c) => c.action === "disable_user",
            ).length,
            add_membership: result.changes.filter(
              (c) => c.action === "add_membership",
            ).length,
            remove_membership: result.changes.filter(
              (c) => c.action === "remove_membership",
            ).length,
            error: result.error ?? null,
          },
        },
      });

      for (const change of result.changes) {
        await deps.db.directorySyncChange.create({
          data: {
            runId: run.id,
            action: change.action,
            userEmail: change.userEmail,
            oldValues: change.oldValues as any,
            newValues: change.newValues as any,
            status: config.syncMode === "apply" ? "applied" : "pending",
          },
        });
      }

      return reply.status(200).send({
        runId: run.id,
        status: result.status,
        changesCount: result.changes.length,
        error: result.error ?? null,
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/admin/directory-sync/runs/:id", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const { id } = request.params as { id: string };
      const run = await deps.db.directorySyncRun.findUnique({ where: { id } });
      if (!run) {
        return reply
          .status(404)
          .send({ error: "directory sync run not found" });
      }

      return reply.status(200).send(run);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/admin/directory-sync/runs/:id/changes", async (request, reply) => {
    try {
      const auth = await authenticate(deps.db, extractBearerToken(request));
      if (!auth) {
        return sendError(reply, new UnauthorizedError("invalid_api_key"));
      }
      if (!auth.isAdmin) {
        return sendError(reply, new ForbiddenError("admin_required"));
      }

      const { id } = request.params as { id: string };
      const changes = await deps.db.directorySyncChange.findMany({
        where: { runId: id },
        orderBy: { createdAt: "asc" },
      });

      return reply.status(200).send({ object: "list", data: changes });
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
