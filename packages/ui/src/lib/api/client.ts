import { readSession } from "../session";
import type { ListResponse } from "@ai-gateway/shared";

const LATENCY_MS = 260;
const API_BASE_URL = (import.meta.env["VITE_API_BASE_URL"] ?? "").replace(/\/$/, "");

export function hasBackendApi(): boolean {
  return API_BASE_URL.length > 0;
}

export function simulate<T>(value: T, latency = LATENCY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), latency));
}

export function fail(message: string, latency = LATENCY_MS): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), latency));
}

export function nextId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
}

function withQuery(path: string, query: ApiRequestOptions["query"]): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function parseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown; message?: unknown };
    return String(payload.error ?? payload.message ?? response.statusText);
  } catch {
    return response.statusText || "Request failed";
  }
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  if (!hasBackendApi()) {
    throw new ApiError("Backend API is not configured", 0);
  }

  const token = options.token ?? readSession()?.token;
  const headers: Record<string, string> = {};
  if (token) headers["authorization"] = `Bearer ${token}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  const init: RequestInit = {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${API_BASE_URL}${withQuery(path, options.query)}`, init);

  if (!response.ok) {
    throw new ApiError(await parseError(response), response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function apiList<T>(path: string, options?: ApiRequestOptions): Promise<T[]> {
  const envelope = await apiRequest<ListResponse<T>>(path, options);
  return envelope.data;
}
