import type {
  DirectoryProvider,
  DirectorySnapshot,
  DirectoryUser,
  DirectoryGroup,
} from "./types.js";

export interface AzureAdConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

interface GraphUser {
  id: string;
  displayName?: string;
  mail?: string | null;
  userPrincipalName: string;
}

interface GraphGroup {
  id: string;
  displayName?: string;
}

interface GraphMember {
  id: string;
  [key: string]: unknown;
}

function emailFromGraphUser(user: GraphUser): string {
  return user.mail && user.mail.length > 0 ? user.mail : user.userPrincipalName;
}

export function createAzureAdProvider(
  config: AzureAdConfig,
  fetchImpl: typeof fetch = fetch,
): DirectoryProvider {
  return {
    async fetchDirectory(): Promise<DirectorySnapshot> {
      const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;
      const params = new URLSearchParams();
      params.set("client_id", config.clientId);
      params.set("client_secret", config.clientSecret);
      params.set("scope", "https://graph.microsoft.com/.default");
      params.set("grant_type", "client_credentials");

      const tokenRes = await fetchImpl(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      if (!tokenRes.ok) {
        const text = await tokenRes.text();
        throw new Error(
          `Azure AD token request failed: ${tokenRes.status} ${text}`,
        );
      }

      const tokenData = (await tokenRes.json()) as { access_token: string };
      const headers = { Authorization: `Bearer ${tokenData.access_token}` };

      const [usersRes, groupsRes] = await Promise.all([
        fetchImpl(
          "https://graph.microsoft.com/v1.0/users?$select=id,displayName,mail,userPrincipalName",
          { headers },
        ),
        fetchImpl(
          "https://graph.microsoft.com/v1.0/groups?$select=id,displayName",
          { headers },
        ),
      ]);

      if (!usersRes.ok) {
        throw new Error(`Azure AD users request failed: ${usersRes.status}`);
      }
      if (!groupsRes.ok) {
        throw new Error(`Azure AD groups request failed: ${groupsRes.status}`);
      }

      const usersData = (await usersRes.json()) as { value: GraphUser[] };
      const groupsData = (await groupsRes.json()) as { value: GraphGroup[] };

      const userGroups = new Map<string, Set<string>>();
      for (const user of usersData.value) {
        userGroups.set(user.id, new Set());
      }

      for (const group of groupsData.value) {
        const membersRes = await fetchImpl(
          `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(group.id)}/members?$select=id`,
          { headers },
        );
        if (!membersRes.ok) {
          continue;
        }
        const membersData = (await membersRes.json()) as {
          value: GraphMember[];
        };
        for (const member of membersData.value) {
          const groupsForUser = userGroups.get(member.id);
          if (groupsForUser) {
            groupsForUser.add(group.id);
          }
        }
      }

      const users: DirectoryUser[] = usersData.value.map((user) => ({
        externalId: user.id,
        email: emailFromGraphUser(user),
        name: user.displayName ?? null,
        groupIds: Array.from(userGroups.get(user.id) ?? []),
      }));

      const groups: DirectoryGroup[] = groupsData.value.map((group) => ({
        externalId: group.id,
        name: group.displayName ?? group.id,
      }));

      return { users, groups };
    },
  };
}
