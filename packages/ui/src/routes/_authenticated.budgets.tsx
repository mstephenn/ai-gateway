import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "@/components/console/DataTable";
import { DetailDrawer, Field } from "@/components/console/DetailDrawer";
import { FilterBar, FilterSelect, SearchInput } from "@/components/console/FilterBar";
import { PageHeader } from "@/components/console/PageHeader";
import { StatusBadge } from "@/components/console/StatusBadge";
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
import { getBudgetMetrics, type BudgetMetrics } from "@/lib/api/budgets";
import { listApiKeys, updateApiKey, type UpdateKeyInput } from "@/lib/api/keys";
import { listTeams, updateTeam, type TeamInput } from "@/lib/api/teams";
import { compactNumber, fullNumber, percent } from "@/lib/format";
import type { ApiKey, BudgetEntry, Team } from "@/lib/mock-data/types";

export const Route = createFileRoute("/_authenticated/budgets")({
  head: () => ({
    meta: [
      { title: "Budgets - AI Gateway Admin Console" },
      {
        name: "description",
        content: "Track token budgets across teams and API keys.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BudgetsPage,
});

type BudgetScope = "team" | "key";

interface BudgetForm {
  scope: BudgetScope;
  entityId: string;
  budgetTokens: number;
}

const EMPTY_FORM: BudgetForm = {
  scope: "team",
  entityId: "",
  budgetTokens: 1_000_000,
};

function BudgetsPage() {
  const qc = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ["budgets"],
    queryFn: getBudgetMetrics,
  });
  const { data: teams } = useQuery({ queryKey: ["teams"], queryFn: listTeams });
  const { data: keys } = useQuery({ queryKey: ["apiKeys"], queryFn: listApiKeys });
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("all");
  const [status, setStatus] = useState("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState<BudgetForm>(EMPTY_FORM);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["budgets"] });
    qc.invalidateQueries({ queryKey: ["teams"] });
    qc.invalidateQueries({ queryKey: ["apiKeys"] });
  };

  const save = useMutation({
    mutationFn: async (input: BudgetForm) => {
      if (input.scope === "team") {
        const team = teams?.find((t) => t.id === input.entityId);
        if (!team) throw new Error("Team not found");
        const { id: _id, createdAt: _c, usedTokens: _u, ...rest } = team;
        const payload: TeamInput = { ...rest, budgetTokens: input.budgetTokens };
        await updateTeam(team.id, payload);
      } else {
        const key = keys?.find((k) => k.id === input.entityId);
        if (!key) throw new Error("Key not found");
        const payload: UpdateKeyInput = {
          name: key.name,
          ownerType: key.ownerType,
          ownerId: key.ownerId,
          ownerName: key.ownerName,
          expiresAt: key.expiresAt,
          budgetLimit: input.budgetTokens,
          rpmLimit: key.rpmLimit,
          tpmLimit: key.tpmLimit,
          allowedModels: key.allowedModels,
        };
        await updateApiKey(key.id, payload);
      }
    },
    onSuccess: () => {
      invalidate();
      setDrawerOpen(false);
      setForm(EMPTY_FORM);
      toast.success("Budget saved");
    },
  });

  const eligibleEntities = useMemo(() => {
    if (form.scope === "team") {
      return teams ?? [];
    }
    return keys ?? [];
  }, [form.scope, teams, keys]);

  function openCreate() {
    const firstTeam = teams?.[0];
    const firstKey = keys?.[0];
    const scope: BudgetScope = firstTeam ? "team" : firstKey ? "key" : "team";
    const entityId = scope === "team" ? firstTeam?.id ?? "" : firstKey?.id ?? "";
    setForm({ ...EMPTY_FORM, scope, entityId });
    setDrawerOpen(true);
  }

  const rows = useMemo(() => {
    return (data?.entries ?? []).filter((entry) => {
      if (scope !== "all" && entry.scope !== scope) return false;
      if (status !== "all" && entry.status !== status) return false;
      if (search) {
        const hay = `${entry.name} ${entry.ownerName ?? ""}`.toLowerCase();
        if (!hay.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [data, scope, status, search]);

  const canSubmit = form.entityId && form.budgetTokens > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Budgets"
        description="Token budgets across teams and API keys."
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" /> Create budget
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi
          label="Total budgeted"
          value={data ? compactNumber(data.summary.totalBudgeted) : "—"}
          loading={isPending}
        />
        <Kpi
          label="Total used"
          value={data ? compactNumber(data.summary.totalUsed) : "—"}
          loading={isPending}
        />
        <Kpi
          label="Remaining"
          value={data ? compactNumber(data.summary.totalRemaining) : "—"}
          loading={isPending}
        />
        <Kpi
          label="Exceeded"
          value={data ? fullNumber(data.summary.exceededCount) : "—"}
          loading={isPending}
          tone="danger"
        />
        <Kpi
          label="Critical / Warning"
          value={
            data
              ? `${fullNumber(data.summary.criticalCount)} / ${fullNumber(data.summary.warningCount)}`
              : "—"
          }
          loading={isPending}
          tone="warning"
        />
      </div>

      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search budgets..." />
        <FilterSelect
          label="Scope"
          value={scope}
          onChange={setScope}
          width="w-32"
          options={[
            { value: "all", label: "All scopes" },
            { value: "team", label: "Teams" },
            { value: "key", label: "Keys" },
          ]}
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={setStatus}
          width="w-40"
          options={[
            { value: "all", label: "All statuses" },
            { value: "healthy", label: "Healthy" },
            { value: "warning", label: "Warning" },
            { value: "critical", label: "Critical" },
            { value: "exceeded", label: "Exceeded" },
          ]}
        />
      </FilterBar>

      <DataTable
        loading={isPending}
        rows={rows}
        rowKey={(row) => `${row.scope}-${row.id}`}
        empty="No budgets match these filters."
        columns={[
          {
            key: "name",
            header: "Name",
            cell: (row) => (
              <div>
                <div className="font-medium">{row.name}</div>
                {row.ownerName ? (
                  <div className="text-xs text-muted-foreground">{row.ownerName}</div>
                ) : null}
              </div>
            ),
          },
          {
            key: "scope",
            header: "Scope",
            cell: (row) => <BudgetScopeBadge scope={row.scope} />,
          },
          {
            key: "budget",
            header: "Budget",
            className: "tabular text-right",
            cell: (row) => compactNumber(row.budgetTokens),
          },
          {
            key: "used",
            header: "Used",
            className: "tabular text-right",
            cell: (row) => compactNumber(row.usedTokens),
          },
          {
            key: "remaining",
            header: "Remaining",
            className: "tabular text-right",
            cell: (row) => compactNumber(row.remainingTokens),
          },
          {
            key: "progress",
            header: "Usage",
            cell: (row) => <BudgetProgress entry={row} />,
          },
          {
            key: "status",
            header: "Status",
            cell: (row) => <StatusBadge status={row.status} />,
          },
        ]}
      />

      <DetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title="Create budget"
        description="Assign a token budget to a team or API key."
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setDrawerOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={!canSubmit || save.isPending} onClick={() => save.mutate(form)}>
              {save.isPending ? "Saving…" : "Save budget"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Scope">
            <Select
              value={form.scope}
              onValueChange={(value) =>
                setForm({ ...form, scope: value as BudgetScope, entityId: "" })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="team">Team</SelectItem>
                <SelectItem value="key">API key</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label={form.scope === "team" ? "Team" : "API key"}>
            <Select value={form.entityId} onValueChange={(value) => setForm({ ...form, entityId: value })}>
              <SelectTrigger>
                <SelectValue placeholder={`Select ${form.scope}`} />
              </SelectTrigger>
              <SelectContent>
                {eligibleEntities.length === 0 ? (
                  <SelectItem value="" disabled>
                    No {form.scope === "team" ? "teams" : "keys"} available
                  </SelectItem>
                ) : (
                  eligibleEntities.map((entity) => (
                    <SelectItem key={entity.id} value={entity.id}>
                      {entity.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Budget tokens">
            <Input
              type="number"
              min={1}
              value={form.budgetTokens}
              onChange={(e) =>
                setForm({ ...form, budgetTokens: Math.max(0, Number(e.target.value)) })
              }
            />
          </Field>
        </div>
      </DetailDrawer>
    </div>
  );
}

function Kpi({
  label,
  value,
  loading,
  tone,
}: {
  label: string;
  value: string;
  loading?: boolean;
  tone?: "danger" | "warning";
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={
          "mt-2 tabular text-2xl font-semibold " +
          (tone === "danger"
            ? "text-destructive"
            : tone === "warning"
              ? "text-warning-foreground"
              : "text-foreground")
        }
      >
        {loading ? "—" : value}
      </div>
    </div>
  );
}

function BudgetScopeBadge({ scope }: { scope: BudgetEntry["scope"] }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium capitalize">
      {scope}
    </span>
  );
}

function BudgetProgress({ entry }: { entry: BudgetEntry }) {
  const percentUsed = Math.min(100, entry.percentUsed);
  return (
    <div className="w-40">
      <div className="tabular flex justify-between text-xs text-muted-foreground">
        <span>{percent(entry.percentUsed, 1)}</span>
      </div>
      <Progress value={percentUsed} className="mt-1 h-1.5" />
    </div>
  );
}
