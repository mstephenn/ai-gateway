export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class ModelNotFoundError extends Error {
  constructor(modelName: string) {
    super(`Unknown model "${modelName}"`);
    this.name = "ModelNotFoundError";
  }
}

export class UpstreamHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "UpstreamHttpError";
    this.status = status;
  }
}

export class UpstreamError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UpstreamError";
  }
}

export class AllDeploymentsExhaustedError extends Error {
  constructor(modelName: string) {
    super(`All deployments exhausted for model "${modelName}"`);
    this.name = "AllDeploymentsExhaustedError";
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export class ModelAccessDeniedError extends Error {
  constructor(modelName: string) {
    super(`Access denied to model "${modelName}"`);
    this.name = "ModelAccessDeniedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export class GuardrailBlockedError extends Error {
  blockedTerms: string[];

  constructor(message: string, blockedTerms: string[] = []) {
    super(message);
    this.name = "GuardrailBlockedError";
    this.blockedTerms = blockedTerms;
  }
}

export function statusForError(err: unknown): number {
  if (err instanceof UnauthorizedError) {
    return 401;
  }
  if (err instanceof ValidationError) {
    return 400;
  }
  if (err instanceof BudgetExceededError) {
    return 403;
  }
  if (err instanceof ModelAccessDeniedError) {
    return 403;
  }
  if (err instanceof ModelNotFoundError) {
    return 404;
  }
  if (err instanceof RateLimitError) {
    return 429;
  }
  if (err instanceof AllDeploymentsExhaustedError) {
    return 503;
  }
  if (err instanceof UpstreamHttpError) {
    return 502;
  }
  if (err instanceof UpstreamError) {
    return 502;
  }
  if (err instanceof TimeoutError) {
    return 504;
  }
  if (err instanceof ForbiddenError) {
    return 403;
  }
  if (err instanceof ConflictError) {
    return 409;
  }
  if (err instanceof GuardrailBlockedError) {
    return 400;
  }
  return 500;
}
