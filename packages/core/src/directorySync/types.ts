export interface DirectoryUser {
  externalId: string;
  email: string;
  name: string | null;
  groupIds: string[];
}

export interface DirectoryGroup {
  externalId: string;
  name: string;
}

export interface DirectorySnapshot {
  users: DirectoryUser[];
  groups: DirectoryGroup[];
}

export interface DirectoryProvider {
  fetchDirectory(): Promise<DirectorySnapshot>;
}

export interface SyncChange {
  action:
    | "create_user"
    | "update_user"
    | "disable_user"
    | "add_membership"
    | "remove_membership";
  userEmail: string;
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
}

export interface SyncRunResult {
  status: "completed" | "failed";
  changes: SyncChange[];
  error?: string;
}
