import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { UsageGroupBy } from "@ai-gateway/shared";
import { DataTable } from "@/components/console/DataTable";
import { DetailDrawer, DetailRow } from "@/components/console/DetailDrawer";
import { FilterBar, FilterSelect, SearchInput } from "@/components/console/FilterBar";
import { PageHeader } from "@/components/console/PageHeader";
import { StatusBadge } from "@/components/console/StatusBadge";
import { Button } from "@/components/ui/button";
import { listRequestLogs, listUsageGroups, type UsageFilters } from "@/lib/api/usage";
import { listApiKeys } from "@/lib/api/keys";
import { listTeams } from "@/lib/api/teams";
import { compactNumber, dateTime, fullNumber, ms } from "@/lib/format";
import type { RequestLog } from "@/lib/mock-data/types";

export const Route = createFileRoute("/_authenticated/usage")({
  head: () => ({
    meta: [
      { title: "Usage - AI Gateway Admin Console" },
      {
        name: "description",
        content: "Filter AI Gateway request logs by model, team, key and status.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: UsagePage,
});

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: UsageFilters = {
  range: "24h",
  model: "all",
  teamId: "all",
  keyId: "all",
  status: "all",
  search: "",
};

function UsagePage() {
  const [filters, setFilters] = useState<UsageFilters>(DEFAULT_FILTERS);
  const [groupBy, setGroupBy] = useState<UsageGroupBy>("team");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<RequestLog | null>(null);
  const { data: logs, isPending } = useQuery({
    queryKey: ["usage", filters],
    queryFn: () => listRequestLogs(filters),
  });
  const { data: usageGroups, isPending: groupsPending } = useQuery({
    queryKey: ["usageGroups", filters, groupBy],
    queryFn: () => listUsageGroups(filters, groupBy),
  });
  const { data: teams } = useQuery({ queryKey: ["teams"], queryFn: listTeams });
  const { data: keys } = useQuery({ queryKey: ["apiKeys"], queryFn: listApiKeys });

  const modelOptions = useMemo(() => {
    const models = Array.from(new Set((logs ?? []).map((log) => log.model))).sort();
    return [
      { value: "all", label: "All models" },
      ...models.map((model) => ({ value: model, label: model })),
    ];
  }, [logs]);

  const rows = logs ?? [];
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totals = rows.reduce(
    (acc, row) => ({
      requests: acc.requests + 1,
      input: acc.input + row.inputTokens,
      output: acc.output + row.outputTokens,
      errors: acc.errors + (row.status === "success" ? 0 : 1),
    }),
    { requests: 0, input: 0, output: 0, errors: 0 },
  );
  const aggregateTotals = (usageGroups?.data ?? []).reduce(
    (acc, row) => ({
      requests: acc.requests + row.requestCount,
      input: acc.input + row.inputTokens,
      output: acc.output + row.outputTokens,
      cost: acc.cost + row.estimatedCost,
    }),
    { requests: 0, input: 0, output: 0, cost: 0 },
  );
  const visibleTotals = aggregateTotals.requests > 0 ? aggregateTotals : { ...totals, cost: 0 };

  function updateFilters(patch: Partial<UsageFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Usage"
        description="Request logs for debugging traffic, failures and token consumption."
        actions={
          <Button variant="outline" size="sm" onClick={() => updateFilters(DEFAULT_FILTERS)}>
            Reset filters
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Requests" value={compactNumber(visibleTotals.requests)} />
        <Metric label="Input tokens" value={compactNumber(visibleTotals.input)} />
        <Metric label="Output tokens" value={compactNumber(visibleTotals.output)} />
        <Metric
          label="Estimated cost"
          value={visibleTotals.cost ? `$${visibleTotals.cost.toFixed(2)}` : "—"}
        />
      </div>

      <FilterBar>
        <SearchInput
          value={filters.search}
          onChange={(value) => updateFilters({ search: value })}
          placeholder="Search logs..."
        />
        <FilterSelect
          label="Range"
          value={filters.range}
          onChange={(value) => updateFilters({ range: value as UsageFilters["range"] })}
          width="w-32"
          options={[
            { value: "1h", label: "Last hour" },
            { value: "24h", label: "Last 24h" },
            { value: "7d", label: "Last 7d" },
            { value: "30d", label: "Last 30d" },
          ]}
        />
        <FilterSelect
          label="Model"
          value={filters.model}
          onChange={(value) => updateFilters({ model: value })}
          width="w-48"
          options={modelOptions}
        />
        <FilterSelect
          label="Team"
          value={filters.teamId}
          onChange={(value) => updateFilters({ teamId: value })}
          width="w-48"
          options={[
            { value: "all", label: "All teams" },
            ...(teams ?? []).map((team) => ({ value: team.id, label: team.name })),
          ]}
        />
        <FilterSelect
          label="Key"
          value={filters.keyId}
          onChange={(value) => updateFilters({ keyId: value })}
          width="w-44"
          options={[
            { value: "all", label: "All keys" },
            ...(keys ?? []).map((key) => ({ value: key.id, label: key.name })),
          ]}
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(value) => updateFilters({ status: value as UsageFilters["status"] })}
          width="w-40"
          options={[
            { value: "all", label: "All statuses" },
            { value: "success", label: "Success" },
            { value: "error", label: "Error" },
            { value: "rate_limited", label: "Rate limited" },
            { value: "timeout", label: "Timeout" },
          ]}
        />
      </FilterBar>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Usage summary</h2>
          <FilterSelect
            label="Group"
            value={groupBy}
            onChange={(value) => setGroupBy(value as UsageGroupBy)}
            width="w-36"
            options={[
              { value: "team", label: "By team" },
              { value: "key", label: "By key" },
              { value: "model", label: "By model" },
            ]}
          />
        </div>
        <DataTable
          loading={groupsPending}
          rows={usageGroups?.data ?? []}
          rowKey={(row) => row.groupValue}
          empty="No usage has been recorded for this range."
          columns={[
            {
              key: "label",
              header: "Name",
              cell: (row) => <span className="font-medium">{row.label}</span>,
            },
            {
              key: "requests",
              header: "Requests",
              className: "tabular text-right",
              cell: (row) => fullNumber(row.requestCount),
            },
            {
              key: "input",
              header: "Input tokens",
              className: "tabular text-right",
              cell: (row) => fullNumber(row.inputTokens),
            },
            {
              key: "output",
              header: "Output tokens",
              className: "tabular text-right",
              cell: (row) => fullNumber(row.outputTokens),
            },
            {
              key: "total",
              header: "Total tokens",
              className: "tabular text-right",
              cell: (row) => fullNumber(row.totalTokens),
            },
            {
              key: "cost",
              header: "Estimated cost",
              className: "tabular text-right",
              cell: (row) => (row.estimatedCost ? `$${row.estimatedCost.toFixed(4)}` : "—"),
            },
          ]}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Request log</h2>
        <DataTable
          loading={isPending}
          rows={pageRows}
          rowKey={(row) => row.id}
          onRowClick={setSelected}
          empty="No request logs match these filters."
          columns={[
            { key: "created", header: "Created", cell: (row) => dateTime(row.createdAt) },
            {
              key: "model",
              header: "Model",
              cell: (row) => <span className="font-mono text-xs">{row.model}</span>,
            },
            { key: "team", header: "Team", cell: (row) => row.teamName },
            {
              key: "key",
              header: "Key",
              cell: (row) => <span className="font-mono text-xs">{row.keyPrefix}</span>,
            },
            { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
            {
              key: "code",
              header: "HTTP",
              className: "tabular text-right",
              cell: (row) => row.statusCode,
            },
            {
              key: "latency",
              header: "Latency",
              className: "tabular text-right",
              cell: (row) => ms(row.latencyMs),
            },
            {
              key: "input",
              header: "Input",
              className: "tabular text-right",
              cell: (row) => fullNumber(row.inputTokens),
            },
            {
              key: "output",
              header: "Output",
              className: "tabular text-right",
              cell: (row) => fullNumber(row.outputTokens),
            },
          ]}
        />
      </section>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Page {page} of {totalPages} · {fullNumber(rows.length)} records
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page === 1}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={page === totalPages}
          >
            Next
          </Button>
        </div>
      </div>

      <DetailDrawer
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
        title={selected?.id ?? "Request"}
        description="Gateway request metadata. Prompt and response bodies are intentionally not shown."
      >
        {selected ? (
          <div className="space-y-1">
            <DetailRow label="Created" value={dateTime(selected.createdAt)} />
            <DetailRow
              label="Route"
              value={<span className="font-mono text-xs">{selected.route}</span>}
            />
            <DetailRow
              label="Model"
              value={<span className="font-mono text-xs">{selected.model}</span>}
            />
            <DetailRow
              label="Provider"
              value={<span className="font-mono text-xs">{selected.provider}</span>}
            />
            <DetailRow label="Team" value={selected.teamName} />
            <DetailRow
              label="Key prefix"
              value={<span className="font-mono text-xs">{selected.keyPrefix}</span>}
            />
            <DetailRow label="Status" value={<StatusBadge status={selected.status} />} />
            <DetailRow label="HTTP status" value={selected.statusCode} />
            <DetailRow label="Latency" value={ms(selected.latencyMs)} />
            <DetailRow label="Input tokens" value={fullNumber(selected.inputTokens)} />
            <DetailRow label="Output tokens" value={fullNumber(selected.outputTokens)} />
          </div>
        ) : null}
      </DetailDrawer>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 tabular text-2xl font-semibold text-foreground">{value}</div>
    </div>
  );
}
