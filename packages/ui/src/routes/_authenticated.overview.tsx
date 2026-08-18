import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/console/PageHeader";
import { StatusBadge } from "@/components/console/StatusBadge";
import { DataTable } from "@/components/console/DataTable";
import { FilterSelect } from "@/components/console/FilterBar";
import { getOverviewMetrics } from "@/lib/api/overview";
import { compactNumber, fullNumber, ms, percent } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/overview")({
  head: () => ({
    meta: [
      { title: "Overview — AI Gateway Admin Console" },
      {
        name: "description",
        content:
          "Request volume, token usage, error rate, latency and provider health across the AI Gateway.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Overview — AI Gateway Admin Console" },
      {
        property: "og:description",
        content: "Live gateway traffic, latency and provider health at a glance.",
      },
    ],
  }),
  component: OverviewPage,
});

function Kpi({
  label,
  value,
  delta,
  hint,
}: {
  label: string;
  value: string;
  delta?: number | undefined;
  hint?: string | undefined;
}) {
  const positive = (delta ?? 0) >= 0;
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="tabular text-2xl font-semibold text-foreground">{value}</span>
        {delta !== undefined ? (
          <span
            className={
              positive ? "text-xs font-medium text-success" : "text-xs font-medium text-destructive"
            }
          >
            {positive ? "+" : ""}
            {delta.toFixed(1)}%
          </span>
        ) : null}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function OverviewPage() {
  const [range, setRange] = useState("24h");
  const { data, isPending } = useQuery({
    queryKey: ["overview", range],
    queryFn: () => getOverviewMetrics(range),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Overview"
        description="Gateway traffic, reliability and provider health."
        actions={
          <FilterSelect
            label="Range"
            value={range}
            onChange={setRange}
            width="w-32"
            options={[
              { value: "24h", label: "Last 24h" },
              { value: "7d", label: "Last 7 days" },
              { value: "30d", label: "Last 30 days" },
            ]}
          />
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Requests"
          value={isPending ? "—" : compactNumber(data!.requestVolume)}
          delta={data?.requestVolumeDelta}
        />
        <Kpi
          label="Tokens"
          value={isPending ? "—" : compactNumber(data!.totalTokens)}
          delta={data?.totalTokensDelta}
        />
        <Kpi
          label="Error rate"
          value={isPending ? "—" : percent(data!.errorRate)}
          delta={data?.errorRateDelta}
        />
        <Kpi
          label="Latency p95"
          value={isPending ? "—" : ms(data!.p95LatencyMs)}
          delta={data?.latencyDelta}
          hint={data ? `p50 ${ms(data.p50LatencyMs)}` : undefined}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <div className="rounded-md border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Request volume</h2>
          <div className="mt-3 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.series ?? []}>
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
          </div>
        </div>

        <div className="rounded-md border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">p95 latency</h2>
          <div className="mt-3 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.series ?? []}>
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
                  dataKey="p95"
                  stroke="var(--chart-2)"
                  dot={false}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Top models</h2>
          <DataTable
            loading={isPending}
            rowKey={(r) => r.model}
            rows={data?.topModels ?? []}
            columns={[
              {
                key: "model",
                header: "Model",
                cell: (r) => <span className="font-mono text-xs">{r.model}</span>,
              },
              {
                key: "req",
                header: "Requests",
                className: "tabular text-right",
                cell: (r) => fullNumber(r.requests),
              },
              {
                key: "tok",
                header: "Tokens",
                className: "tabular text-right",
                cell: (r) => compactNumber(r.tokens),
              },
              {
                key: "err",
                header: "Error rate",
                className: "tabular text-right",
                cell: (r) => percent(r.errorRate),
              },
            ]}
          />
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Top teams</h2>
          <DataTable
            loading={isPending}
            rowKey={(r) => r.team}
            rows={data?.topTeams ?? []}
            columns={[
              { key: "team", header: "Team", cell: (r) => r.team },
              {
                key: "req",
                header: "Requests",
                className: "tabular text-right",
                cell: (r) => fullNumber(r.requests),
              },
              {
                key: "tok",
                header: "Tokens",
                className: "tabular text-right",
                cell: (r) => compactNumber(r.tokens),
              },
              {
                key: "budget",
                header: "Budget used",
                className: "tabular text-right",
                cell: (r) => percent(r.budgetUsed, 0),
              },
            ]}
          />
        </section>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Provider health</h2>
        <DataTable
          loading={isPending}
          rowKey={(r) => r.provider}
          rows={data?.providerHealth ?? []}
          columns={[
            {
              key: "provider",
              header: "Provider",
              cell: (r) => <span className="font-mono text-xs">{r.provider}</span>,
            },
            { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
            {
              key: "sr",
              header: "Success rate",
              className: "tabular text-right",
              cell: (r) => percent(r.successRate),
            },
            {
              key: "p95",
              header: "p95",
              className: "tabular text-right",
              cell: (r) => ms(r.p95LatencyMs),
            },
            {
              key: "dep",
              header: "Deployments",
              className: "tabular text-right",
              cell: (r) => r.deployments,
            },
          ]}
        />
      </section>
    </div>
  );
}
