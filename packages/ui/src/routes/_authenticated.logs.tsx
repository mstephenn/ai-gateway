import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DataTable } from "@/components/console/DataTable";
import { DetailDrawer, DetailRow } from "@/components/console/DetailDrawer";
import { FilterBar, FilterSelect, SearchInput } from "@/components/console/FilterBar";
import { PageHeader } from "@/components/console/PageHeader";
import { StatusBadge } from "@/components/console/StatusBadge";
import { Button } from "@/components/ui/button";
import { listRequestLogs, type UsageFilters } from "@/lib/api/usage";
import { listApiKeys } from "@/lib/api/keys";
import { listTeams } from "@/lib/api/teams";
import { dateTime, fullNumber, ms } from "@/lib/format";
import type { RequestLog } from "@/lib/mock-data/types";

export const Route = createFileRoute("/_authenticated/logs")({
  head: () => ({
    meta: [
      { title: "Request Logs - AI Gateway Admin Console" },
      {
        name: "description",
        content: "Browse and inspect AI Gateway request logs.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LogsPage,
});

const PAGE_SIZE = 25;

const DEFAULT_FILTERS: UsageFilters = {
  range: "24h",
  model: "all",
  teamId: "all",
  keyId: "all",
  status: "all",
  search: "",
};

function LogsPage() {
  const [filters, setFilters] = useState<UsageFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<RequestLog | null>(null);
  const { data: logs, isPending } = useQuery({
    queryKey: ["logs", filters],
    queryFn: () => listRequestLogs(filters),
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
  const safePage = Math.min(page, totalPages);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function updateFilters(patch: Partial<UsageFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Request Logs"
        description="Browse and inspect gateway request logs."
        actions={
          <Button variant="outline" size="sm" onClick={() => updateFilters(DEFAULT_FILTERS)}>
            Reset filters
          </Button>
        }
      />

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

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Showing {(safePage - 1) * PAGE_SIZE + 1}-{Math.min(safePage * PAGE_SIZE, rows.length)} of{" "}
          {fullNumber(rows.length)} records · Page {safePage} of {totalPages}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={safePage === 1}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={safePage === totalPages}
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
