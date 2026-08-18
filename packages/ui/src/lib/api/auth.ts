import { ADMIN_BEARER_KEY } from "../mock-data/fixtures";
import { apiRequest, fail, hasBackendApi, simulate } from "./client";

export interface AdminSession {
  token: string;
  adminEmail: string;
  organization: string;
  isAdmin: boolean;
}

interface AdminMeResponse {
  apiKeyId: string;
  isAdmin: boolean;
  teamId: string | null;
  allowedModels: string[];
}

export async function signIn(bearerKey: string): Promise<AdminSession> {
  const key = bearerKey.trim();
  if (hasBackendApi()) {
    let me: AdminMeResponse;
    try {
      me = await apiRequest<AdminMeResponse>("/admin/me", { token: key });
    } catch {
      return fail("Invalid admin bearer key. Check the value and try again.");
    }
    if (!me.isAdmin) {
      return fail("This key does not have admin access.");
    }
    let organization = "AI Gateway";
    try {
      const org = await apiRequest<{ name?: string | null }>("/admin/organization", { token: key });
      organization = org.name ?? organization;
    } catch {
      // The organization endpoint may legitimately be empty during bootstrap.
    }
    return { token: key, adminEmail: me.apiKeyId, organization, isAdmin: true };
  }

  if (key !== ADMIN_BEARER_KEY) {
    return fail("Invalid admin bearer key. Check the value and try again.");
  }
  return simulate({
    token: key,
    adminEmail: "amara.okafor@northwind.example",
    organization: "Northwind Industries",
    isAdmin: true,
  });
}
