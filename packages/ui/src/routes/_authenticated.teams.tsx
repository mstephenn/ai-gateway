import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/console/PageHeader";
import { DataTable } from "@/components/console/DataTable";
import { StatusBadge } from "@/components/console/StatusBadge";
import { ConfirmDialog } from "@/components/console/ConfirmDialog";
import { DetailDrawer, Field } from "@/components/console/DetailDrawer";
import { FilterBar, FilterSelect, SearchInput } from "@/components/console/FilterBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createTeam, deleteTeam, listTeams, updateTeam, type TeamInput } from "@/lib/api/teams";
import { listOrgUnits } from "@/lib/api/org";
import type { Team } from "@/lib/mock-data/types";
import { compactNumber, fullNumber } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/teams")({
  head: () => ({
    meta: [
      { title: "Teams — AI Gateway Admin Console" },
      {
        name: "description",
        content: "Manage teams, token budgets and rate limits for AI Gateway consumers.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Teams — AI Gateway Admin Console" },
      {
        property: "og:description",
        content: "Token budgets, RPM/TPM limits and membership per team.",
      },
    ],
  }),
  component: TeamsPage,
});

const EMPTY: TeamInput = {
  name: "",
  orgUnitId: "",
  members: 1,
  budgetTokens: 1_000_000,
  rpmLimit: 600,
  tpmLimit: 120_000,
  status: "active",
};

function TeamsPage() {
  const qc = useQueryClient();
  const { data, isPending } = useQuery({ queryKey: ["teams"], queryFn: listTeams });
  const { data: units } = useQuery({ queryKey: ["orgUnits"], queryFn: listOrgUnits });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [editing, setEditing] = useState<Team | null>(null);
  const [form, setForm] = useState<TeamInput>(EMPTY);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Team | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["teams"] });

  const save = useMutation({
    mutationFn: (input: TeamInput) => (editing ? updateTeam(editing.id, input) : createTeam(input)),
    onSuccess: () => {
      invalidate();
      setDrawerOpen(false);
      toast.success(editing ? "Team updated" : "Team created");
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteTeam(id),
    onSuccess: () => {
      invalidate();
      setPendingDelete(null);
      toast.success("Team deleted");
    },
  });

  const rows = useMemo(
    () =>
      (data ?? []).filter((t) => {
        if (status !== "all" && t.status !== status) return false;
        if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }),
    [data, status, search],
  );

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY, orgUnitId: units?.[0]?.id ?? "" });
    setDrawerOpen(true);
  }

  function openEdit(row: Team) {
    const { id: _id, createdAt: _c, usedTokens: _u, ...rest } = row;
    setEditing(row);
    setForm(rest);
    setDrawerOpen(true);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Teams"
        description="Budget and rate-limit boundaries for gateway consumers."
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" /> New team
          </Button>
        }
      />

      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search teams…" />
        <FilterSelect
          label="Status"
          value={status}
          onChange={setStatus}
          width="w-36"
          options={[
            { value: "all", label: "All statuses" },
            { value: "active", label: "Active" },
            { value: "suspended", label: "Suspended" },
          ]}
        />
      </FilterBar>

      <DataTable
        loading={isPending}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={openEdit}
        columns={[
          {
            key: "name",
            header: "Team",
            cell: (r) => <span className="font-medium">{r.name}</span>,
          },
          {
            key: "unit",
            header: "Org unit",
            cell: (r) => (
              <span className="text-xs text-muted-foreground">
                {units?.find((u) => u.id === r.orgUnitId)?.name ?? "—"}
              </span>
            ),
          },
          {
            key: "members",
            header: "Members",
            className: "tabular text-right",
            cell: (r) => r.members,
          },
          {
            key: "budget",
            header: "Token budget",
            cell: (r) => (
              <div className="w-40">
                <div className="tabular flex justify-between text-xs text-muted-foreground">
                  <span>{compactNumber(r.usedTokens)}</span>
                  <span>{compactNumber(r.budgetTokens)}</span>
                </div>
                <Progress
                  value={Math.min(100, (r.usedTokens / r.budgetTokens) * 100)}
                  className="mt-1 h-1.5"
                />
              </div>
            ),
          },
          {
            key: "rpm",
            header: "RPM",
            className: "tabular text-right",
            cell: (r) => fullNumber(r.rpmLimit),
          },
          {
            key: "tpm",
            header: "TPM",
            className: "tabular text-right",
            cell: (r) => fullNumber(r.tpmLimit),
          },
          { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
          {
            key: "actions",
            header: "",
            className: "text-right",
            cell: (r) => (
              <div onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="sm" onClick={() => setPendingDelete(r)}>
                  Delete
                </Button>
              </div>
            ),
          },
        ]}
      />

      <DetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title={editing ? `Edit ${editing.name}` : "New team"}
        description="Teams own API keys and inherit budgets from their org unit."
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setDrawerOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => save.mutate(form)} disabled={!form.name}>
              {save.isPending ? "Saving…" : "Save team"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Org unit">
            <Select
              value={form.orgUnitId}
              onValueChange={(v) => setForm({ ...form, orgUnitId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select org unit" />
              </SelectTrigger>
              <SelectContent>
                {(units ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Members">
              <Input
                type="number"
                value={form.members}
                onChange={(e) => setForm({ ...form, members: Number(e.target.value) })}
              />
            </Field>
            <Field label="Budget tokens">
              <Input
                type="number"
                value={form.budgetTokens}
                onChange={(e) => setForm({ ...form, budgetTokens: Number(e.target.value) })}
              />
            </Field>
            <Field label="RPM limit">
              <Input
                type="number"
                value={form.rpmLimit}
                onChange={(e) => setForm({ ...form, rpmLimit: Number(e.target.value) })}
              />
            </Field>
            <Field label="TPM limit">
              <Input
                type="number"
                value={form.tpmLimit}
                onChange={(e) => setForm({ ...form, tpmLimit: Number(e.target.value) })}
              />
            </Field>
          </div>
          <Field label="Status">
            <Select
              value={form.status}
              onValueChange={(v) => setForm({ ...form, status: v as Team["status"] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </DetailDrawer>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title="Delete team"
        description={`Deleting ${pendingDelete?.name ?? ""} revokes its API keys and stops all traffic from its members.`}
        confirmLabel="Delete team"
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
      />
    </div>
  );
}
