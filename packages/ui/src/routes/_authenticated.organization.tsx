import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Play, Plus } from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "@/components/console/DataTable";
import { DetailDrawer, DetailRow, Field } from "@/components/console/DetailDrawer";
import { FilterBar, FilterSelect, SearchInput } from "@/components/console/FilterBar";
import { PageHeader } from "@/components/console/PageHeader";
import { StatusBadge } from "@/components/console/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  createUser,
  getEntraConfig,
  getOrganization,
  listOrgUnits,
  listSyncHistory,
  listUsers,
  previewSync,
  runSync,
  setUserStatus,
  updateEntraConfig,
  updateOrganization,
  updateUser,
  type UserInput,
} from "@/lib/api/org";
import { listTeams } from "@/lib/api/teams";
import { dateTime, ms, relativeTime } from "@/lib/format";
import type { OrgUnit, SyncPreviewEntry, User } from "@/lib/mock-data/types";

export const Route = createFileRoute("/_authenticated/organization")({
  head: () => ({
    meta: [
      { title: "Organization and users - AI Gateway Admin Console" },
      {
        name: "description",
        content:
          "Manage organization structure, users, roles, memberships and Microsoft Entra ID sync.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OrganizationPage,
});

const EMPTY_USER: UserInput = {
  name: "",
  email: "",
  role: "developer",
  teamId: "",
  status: "active",
};

function orgDepth(unit: OrgUnit, units: OrgUnit[]): number {
  let depth = 0;
  let parentId = unit.parentId;
  while (parentId) {
    depth += 1;
    parentId = units.find((candidate) => candidate.id === parentId)?.parentId ?? null;
  }
  return depth;
}

function OrganizationPage() {
  const qc = useQueryClient();
  const { data: org } = useQuery({ queryKey: ["organization"], queryFn: getOrganization });
  const { data: units } = useQuery({ queryKey: ["orgUnits"], queryFn: listOrgUnits });
  const { data: users, isPending } = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const { data: teams } = useQuery({ queryKey: ["teams"], queryFn: listTeams });
  const { data: entra } = useQuery({ queryKey: ["entra"], queryFn: getEntraConfig });
  const { data: syncHistory } = useQuery({ queryKey: ["syncHistory"], queryFn: listSyncHistory });

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [editing, setEditing] = useState<User | null>(null);
  const [userForm, setUserForm] = useState<UserInput>(EMPTY_USER);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [preview, setPreview] = useState<SyncPreviewEntry[]>([]);
  const [orgDraft, setOrgDraft] = useState({
    name: "",
    domain: "",
    defaultRegion: "",
    contactEmail: "",
    configured: true,
  });

  const sortedUnits = useMemo(
    () =>
      [...(units ?? [])].sort(
        (a, b) =>
          orgDepth(a, units ?? []) - orgDepth(b, units ?? []) || a.name.localeCompare(b.name),
      ),
    [units],
  );

  const rows = useMemo(
    () =>
      (users ?? []).filter((user) => {
        if (status !== "all" && user.status !== status) return false;
        if (source !== "all" && user.source !== source) return false;
        if (search) {
          const hay = `${user.name} ${user.email} ${user.role}`.toLowerCase();
          if (!hay.includes(search.toLowerCase())) return false;
        }
        return true;
      }),
    [search, source, status, users],
  );

  const saveOrg = useMutation({
    mutationFn: () => updateOrganization(orgDraft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["organization"] });
      toast.success("Organization updated");
    },
  });

  const saveUser = useMutation({
    mutationFn: (input: UserInput) => (editing ? updateUser(editing.id, input) : createUser(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setDrawerOpen(false);
      toast.success(editing ? "User updated" : "User created");
    },
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: User["status"] }) =>
      setUserStatus(id, nextStatus),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success("User status updated");
    },
  });

  const saveEntra = useMutation({
    mutationFn: () =>
      updateEntraConfig({
        tenantId: entra?.tenantId ?? "",
        clientId: entra?.clientId ?? "",
        enabled: !(entra?.enabled ?? false),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entra"] });
      toast.success("Directory sync setting updated");
    },
  });

  const syncPreview = useMutation({
    mutationFn: previewSync,
    onSuccess: setPreview,
  });

  const syncRun = useMutation({
    mutationFn: runSync,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["syncHistory"] });
      toast.success("Directory sync completed");
    },
  });

  function editOrganization() {
    setOrgDraft({
      name: org?.name ?? "",
      domain: org?.domain ?? "",
      defaultRegion: org?.defaultRegion ?? "",
      contactEmail: org?.contactEmail ?? "",
      configured: org?.configured ?? true,
    });
  }

  function openCreateUser() {
    setEditing(null);
    setUserForm({ ...EMPTY_USER, teamId: teams?.[0]?.id ?? "" });
    setDrawerOpen(true);
  }

  function openEditUser(user: User) {
    const { id: _id, lastLoginAt: _lastLoginAt, source: _source, ...rest } = user;
    setEditing(user);
    setUserForm(rest);
    setDrawerOpen(true);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Organization and users"
        description="Define enterprise structure, user memberships and directory sync."
        actions={
          <Button size="sm" onClick={openCreateUser}>
            <Plus className="size-4" /> New user
          </Button>
        }
      />

      <div className="grid gap-3 xl:grid-cols-[1fr_1.4fr]">
        <section className="rounded-md border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Root organization</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Platform-admin profile for this gateway.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={editOrganization}>
              Load
            </Button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input
                value={orgDraft.name}
                placeholder={org?.name}
                onChange={(event) => setOrgDraft({ ...orgDraft, name: event.target.value })}
              />
            </Field>
            <Field label="Domain">
              <Input
                value={orgDraft.domain}
                placeholder={org?.domain}
                onChange={(event) => setOrgDraft({ ...orgDraft, domain: event.target.value })}
              />
            </Field>
            <Field label="Default region">
              <Input
                value={orgDraft.defaultRegion}
                placeholder={org?.defaultRegion}
                onChange={(event) =>
                  setOrgDraft({ ...orgDraft, defaultRegion: event.target.value })
                }
              />
            </Field>
            <Field label="Contact email">
              <Input
                value={orgDraft.contactEmail}
                placeholder={org?.contactEmail}
                onChange={(event) => setOrgDraft({ ...orgDraft, contactEmail: event.target.value })}
              />
            </Field>
          </div>
          <Button
            className="mt-4"
            size="sm"
            onClick={() => saveOrg.mutate()}
            disabled={!orgDraft.name || saveOrg.isPending}
          >
            Save organization
          </Button>
        </section>

        <section className="rounded-md border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Organization hierarchy</h2>
          <div className="mt-3 space-y-1">
            {sortedUnits.map((unit) => (
              <div
                key={unit.id}
                className="flex items-center gap-2 rounded border border-border bg-muted/30 px-2 py-1.5 text-sm"
              >
                <Building2 className="size-3.5 text-muted-foreground" />
                <span style={{ marginLeft: orgDepth(unit, units ?? []) * 16 }}>{unit.name}</span>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                  {unit.id}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Users</h2>
          <FilterBar>
            <SearchInput value={search} onChange={setSearch} placeholder="Search users..." />
            <FilterSelect
              label="Status"
              value={status}
              onChange={setStatus}
              width="w-36"
              options={[
                { value: "all", label: "All statuses" },
                { value: "active", label: "Active" },
                { value: "invited", label: "Invited" },
                { value: "deactivated", label: "Deactivated" },
              ]}
            />
            <FilterSelect
              label="Source"
              value={source}
              onChange={setSource}
              width="w-36"
              options={[
                { value: "all", label: "All sources" },
                { value: "entra", label: "Directory" },
                { value: "manual", label: "Manual" },
              ]}
            />
          </FilterBar>
        </div>
        <DataTable
          loading={isPending}
          rows={rows}
          rowKey={(row) => row.id}
          onRowClick={openEditUser}
          columns={[
            {
              key: "name",
              header: "User",
              cell: (row) => <span className="font-medium">{row.name}</span>,
            },
            {
              key: "email",
              header: "Email",
              cell: (row) => <span className="text-xs">{row.email}</span>,
            },
            {
              key: "role",
              header: "Role",
              cell: (row) => <span className="capitalize">{row.role}</span>,
            },
            {
              key: "team",
              header: "Team",
              cell: (row) => teams?.find((team) => team.id === row.teamId)?.name ?? "—",
            },
            {
              key: "source",
              header: "Source",
              cell: (row) => (
                <StatusBadge status={row.source === "entra" ? "directory" : row.source} />
              ),
            },
            { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
            { key: "last", header: "Last login", cell: (row) => relativeTime(row.lastLoginAt) },
            {
              key: "action",
              header: "",
              className: "text-right",
              cell: (row) => (
                <div onClick={(event) => event.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      updateStatus.mutate({
                        id: row.id,
                        nextStatus: row.status === "deactivated" ? "active" : "deactivated",
                      })
                    }
                  >
                    {row.status === "deactivated" ? "Reactivate" : "Deactivate"}
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </section>

      <div className="grid gap-3 xl:grid-cols-2">
        <section className="rounded-md border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Microsoft Entra ID sync</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Preview and apply group-driven membership changes.
              </p>
            </div>
            <Switch checked={entra?.enabled ?? false} onCheckedChange={() => saveEntra.mutate()} />
          </div>
          <div className="mt-4 space-y-1">
            <DetailRow
              label="Tenant ID"
              value={<span className="font-mono text-xs">{entra?.tenantId ?? "—"}</span>}
            />
            <DetailRow
              label="Client ID"
              value={<span className="font-mono text-xs">{entra?.clientId ?? "—"}</span>}
            />
            <DetailRow label="Group mappings" value={entra?.mappings.length ?? 0} />
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncPreview.mutate()}
              disabled={syncPreview.isPending}
            >
              Preview sync
            </Button>
            <Button size="sm" onClick={() => syncRun.mutate()} disabled={syncRun.isPending}>
              <Play className="size-4" /> Run sync
            </Button>
          </div>
          {preview.length > 0 ? (
            <DataTable
              rows={preview}
              rowKey={(row) => `${row.email}-${row.action}`}
              columns={[
                { key: "user", header: "User", cell: (row) => row.email },
                {
                  key: "action",
                  header: "Action",
                  cell: (row) => <StatusBadge status={row.action} />,
                },
                {
                  key: "detail",
                  header: "Detail",
                  cell: (row) => <span className="text-xs">{row.detail}</span>,
                },
              ]}
            />
          ) : null}
        </section>

        <section className="rounded-md border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Sync history</h2>
          <DataTable
            rows={syncHistory ?? []}
            rowKey={(row) => row.id}
            columns={[
              { key: "started", header: "Started", cell: (row) => dateTime(row.startedAt) },
              {
                key: "status",
                header: "Status",
                cell: (row) => <StatusBadge status={row.status} />,
              },
              { key: "duration", header: "Duration", cell: (row) => ms(row.durationMs) },
              {
                key: "changes",
                header: "Changes",
                cell: (row) =>
                  `${row.added} add / ${row.updated} update / ${row.deactivated} disable`,
              },
            ]}
          />
        </section>
      </div>

      <DetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title={editing ? `Edit ${editing.name}` : "New user"}
        description="Manual users can later be linked to a directory identity."
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setDrawerOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => saveUser.mutate(userForm)}
              disabled={!userForm.name || !userForm.email || !userForm.teamId}
            >
              Save user
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name">
            <Input
              value={userForm.name}
              onChange={(event) => setUserForm({ ...userForm, name: event.target.value })}
            />
          </Field>
          <Field label="Email">
            <Input
              value={userForm.email}
              onChange={(event) => setUserForm({ ...userForm, email: event.target.value })}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Role">
              <Select
                value={userForm.role}
                onValueChange={(value) => setUserForm({ ...userForm, role: value as User["role"] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">Owner</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="developer">Developer</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Status">
              <Select
                value={userForm.status}
                onValueChange={(value) =>
                  setUserForm({ ...userForm, status: value as User["status"] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="invited">Invited</SelectItem>
                  <SelectItem value="deactivated">Deactivated</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Team">
            <Select
              value={userForm.teamId}
              onValueChange={(value) => setUserForm({ ...userForm, teamId: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select team" />
              </SelectTrigger>
              <SelectContent>
                {(teams ?? []).map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </DetailDrawer>
    </div>
  );
}
