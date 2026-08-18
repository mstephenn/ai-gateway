import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DataTable } from "@/components/console/DataTable";
import { FilterBar, FilterSelect, SearchInput } from "@/components/console/FilterBar";
import { PageHeader } from "@/components/console/PageHeader";
import { StatusBadge } from "@/components/console/StatusBadge";
import { Button } from "@/components/ui/button";
import { listApiKeys } from "@/lib/api/keys";
import { listTeams } from "@/lib/api/teams";
import { listRequestLogs, type UsageFilters } from "@/lib/api/usage";
import { getAnalyticsMetrics } from "@/lib/api/analytics";
import { compactNumber, currency, fullNumber, ms, percent } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics - AI Gateway Admin Console" },
      {
        name: "description",
        content: "Deep-dive analytics into gateway traffic, costs, latency and reliability.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AnalyticsPage,
});

const DEFAULT_FILTERS: UsageFilters = {
  range: "24h",
  model: "all",
  teamId: "all",
  keyId: "all",
  status: "all",
  search: "",
};

function AnalyticsPage() {
  const [filters, setFilters] = useState<UsageFilters>(DEFAULT_FILTERS);
  const { data: logs, isPending: logsPending } = useQuery({
    queryKey: ["analytics-logs", filters],
    queryFn: () => listRequestLogs(filters),
  });
  const { data: metrics, isPending: metricsPending } = useQuery({
    queryKey: ["analytics", filters],
    queryFn: () => getAnalyticsMetrics(filters),
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

  function updateFilters(patch: Partial<UsageFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  const loading = logsPending || metricsPending;
  const series = metrics?.series ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Analytics"
        description="Deep-dive into gateway traffic, costs, latency and reliability."
        actions={
          <Button variant="outline" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>
            Reset filters
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Requests" value={metrics ? fullNumber(metrics.requestCount) : "—"} loading={loading} />
        <Kpi
          label="Total tokens"
          value={metrics ? compactNumber(metrics.totalTokens) : "—"}
          loading={loading}
        />
        <Kpi
          label="Estimated cost"
          value={metrics ? currency(metrics.estimatedCost) : "—"}
          loading={loading}
        />
        <Kpi
          label="Error rate"
          value={metrics ? percent(metrics.errorRate) : "—"}
          loading={loading}
        />
        <Kpi
          label="Latency p95"
          value={metrics ? ms(metrics.p95LatencyMs) : "—"}
          loading={loading}
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
      </FilterBar>

      <div className="grid gap-3 xl:grid-cols-2">
        <ChartCard title="Request volume" loading={loading}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="t" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={44} />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              <Area
                type="monotone"
                dataKey="requests"
                stroke="var(--chart-1)"
                fill="var(--chart-1)"
                fillOpacity={0.15}
              />
              <Area
                type="monotone"
                dataKey="errors"
                stroke="var(--chart-4)"
                fill="var(--chart-4)"
                fillOpacity={0.15}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Token volume" loading={loading}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="t" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={44} />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              <Area
                type="monotone"
                dataKey="inputTokens"
                stroke="var(--chart-1)"
                fill="var(--chart-1)"
                fillOpacity={0.15}
              />
              <Area
                type="monotone"
                dataKey="outputTokens"
                stroke="var(--chart-2)"
                fill="var(--chart-2)"
                fillOpacity={0.15}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Estimated cost" loading={loading}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="t" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke="var(--muted-foreground)"
                width={44}
                tickFormatter={(v) => `$${v}`}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
                formatter={(value: number) => [`$${value.toFixed(2)}`, "Cost"]}
              />
              <Area
                type="monotone"
                dataKey="estimatedCost"
                stroke="var(--chart-3)"
                fill="var(--chart-3)"
                fillOpacity={0.15}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="p95 latency" loading={loading}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="t" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={44} />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              <Line
                type="monotone"
                dataKey="p95LatencyMs"
                stroke="var(--chart-2)"
                dot={false}
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Status distribution</h2>
          <DataTable
            loading={loading}
            rows={metrics?.statusDistribution ?? []}
            rowKey={(row) => row.status}
            empty="No data for this range."
            columns={[
              {
                key: "status",
                header: "Status",
                cell: (row) => <StatusBadge status={row.status} />,
              },
              {
                key: "count",
                header: "Count",
                className: "tabular text-right",
                cell: (row) => fullNumber(row.count),
              },
              {
                key: "percentage",
                header: "Share",
                className: "tabular text-right",
                cell: (row) => percent(row.percentage),
              },
            ]}
          />
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Top models</h2>
          <DataTable
            loading={loading}
            rows={metrics?.byModel ?? []}
            rowKey={(row) => row.key}
            empty="No data for this range."
            columns={[
              {
                key: "label",
                header: "Model",
                cell: (row) => <span className="font-mono text-xs">{row.label}</span>,
              },
              {
                key: "requests",
                header: "Requests",
                className: "tabular text-right",
                cell: (row) => fullNumber(row.requests),
              },
              {
                key: "cost",
                header: "Cost",
                className: "tabular text-right",
                cell: (row) => currency(row.estimatedCost),
              },
            ]}
          />
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Top teams</h2>
          <DataTable
            loading={loading}
            rows={metrics?.byTeam ?? []}
            rowKey={(row) => row.key}
            empty="No data for this range."
            columns={[
              { key: "label", header: "Team", cell: (row) => row.label },
              {
                key: "requests",
                header: "Requests",
                className: "tabular text-right",
                cell: (row) => fullNumber(row.requests),
              },
              {
                key: "cost",
                header: "Cost",
                className: "tabular text-right",
                cell: (row) => currency(row.estimatedCost),
              },
            ]}
          />
        </section>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Usage by key</h2>
        <DataTable
          loading={loading}
          rows={metrics?.byKey ?? []}
          rowKey={(row) => row.key}
          empty="No data for this range."
          columns={[
            {
              key: "label",
              header: "Key",
              cell: (row) => <span className="font-mono text-xs">{row.label}</span>,
            },
            {
              key: "requests",
              header: "Requests",
              className: "tabular text-right",
              cell: (row) => fullNumber(row.requests),
            },
            {
              key: "input",
              header: "Input tokens",
              className: "tabular text-right",
              cell: (row) => compactNumber(row.inputTokens),
            },
            {
              key: "output",
              header: "Output tokens",
              className: "tabular text-right",
              cell: (row) => compactNumber(row.outputTokens),
            },
            {
              key: "total",
              header: "Total tokens",
              className: "tabular text-right",
              cell: (row) => compactNumber(row.totalTokens),
            },
            {
              key: "cost",
              header: "Cost",
              className: "tabular text-right",
              cell: (row) => currency(row.estimatedCost),
            },
            {
              key: "errors",
              header: "Errors",
              className: "tabular text-right",
              cell: (row) => fullNumber(row.errors),
            },
            {
              key: "p95",
              header: "p95 latency",
              className: "tabular text-right",
              cell: (row) => ms(row.p95LatencyMs),
            },
          ]}
        />
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  loading,
}: {
  label: string;
  value: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 tabular text-2xl font-semibold text-foreground">
        {loading ? "—" : value}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  loading,
  children,
}: {
  title: string;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <div className="mt-3 h-56">{loading ? <ChartSkeleton /> : children}</div>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center rounded bg-muted/50">
      <span className="text-xs text-muted-foreground">Loading chart…</span>
    </div>
  );
}
