import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Eye,
  EyeOff,
  Info,
  Pencil,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/console/PageHeader";
import { DataTable } from "@/components/console/DataTable";
import { ConfirmDialog } from "@/components/console/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import {
  createDeployment,
  deleteDeployment,
  listDeployments,
  updateDeployment,
  type DeploymentInput,
} from "@/lib/api/models";
import { hasBackendApi } from "@/lib/api/client";
import { listCredentials as fetchCredentials } from "@/lib/api/credentials";
import type { Deployment, ProviderName } from "@/lib/mock-data/types";
import { currency, dateTime, ms } from "@/lib/format";

function listCredentials() {
  return hasBackendApi() ? fetchCredentials() : Promise.resolve([]);
}

export const Route = createFileRoute("/_authenticated/models")({
  head: () => ({
    meta: [
      { title: "Model Management — AI Gateway Admin Console" },
      {
        name: "description",
        content: "Add and manage models for the proxy.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Model Management — AI Gateway Admin Console" },
      {
        property: "og:description",
        content: "Add and manage models for the proxy.",
      },
    ],
  }),
  component: ModelsPage,
});

const PROVIDERS: ProviderName[] = [
  "azure-openai",
  "openai",
  "anthropic",
  "bedrock",
  "gemini",
  "vertex",
  "mistral",
];

const PROVIDER_LABELS: Record<ProviderName, string> = {
  "azure-openai": "Azure OpenAI",
  openai: "OpenAI",
  anthropic: "Anthropic",
  bedrock: "Amazon Bedrock",
  gemini: "Google Gemini",
  vertex: "Google Vertex AI",
  mistral: "Mistral AI",
};

const TABS = [
  { id: "all", label: "All Models" },
  { id: "add", label: "Add Model" },
  { id: "auto-routers", label: "Auto-Routers", badge: "Beta" },
  { id: "credentials", label: "LLM Credentials" },
  { id: "pass-through", label: "Pass-Through Endpoints" },
  { id: "health", label: "Health Status" },
  { id: "retry", label: "Model Retry Settings" },
  { id: "alias", label: "Model Group Alias" },
  { id: "price", label: "Price Data Reload" },
];

const CHAPTERS = [
  { value: "personal", label: "Personal" },
  { value: "all", label: "All chapters" },
];

const VIEWS = [
  { value: "current", label: "Current Chapter Models" },
  { value: "all", label: "All Models" },
];

const MODES = [
  { value: "", label: "Select mode" },
  { value: "chat", label: "Chat" },
  { value: "embedding", label: "Embedding" },
  { value: "completion", label: "Completion" },
];

const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

const PROVIDER_CREDENTIAL_FIELDS: Record<
  ProviderName,
  Array<{ key: string; label: string; type?: "password" | "text" }>
> = {
  "azure-openai": [
    { key: "apiKey", label: "Azure OpenAI API Key", type: "password" },
    { key: "endpoint", label: "Azure OpenAI Endpoint" },
    { key: "apiVersion", label: "API Version" },
  ],
  openai: [
    { key: "apiKey", label: "OpenAI API Key", type: "password" },
    { key: "organizationId", label: "Organization ID" },
  ],
  anthropic: [{ key: "apiKey", label: "Anthropic API Key", type: "password" }],
  bedrock: [
    { key: "awsAccessKeyId", label: "AWS Access Key ID", type: "password" },
    { key: "awsSecretAccessKey", label: "AWS Secret Access Key", type: "password" },
    { key: "awsBedrockApiKey", label: "AWS Bedrock API Key", type: "password" },
    { key: "awsSessionToken", label: "AWS Session Token", type: "password" },
    { key: "awsRegionName", label: "AWS Region Name" },
  ],
  gemini: [
    { key: "apiKey", label: "Gemini API Key", type: "password" },
    { key: "projectId", label: "Google Cloud Project ID" },
    { key: "location", label: "Location" },
  ],
  vertex: [
    { key: "projectId", label: "Google Cloud Project ID" },
    { key: "location", label: "Location" },
    { key: "credentialsJson", label: "Credentials JSON", type: "password" },
  ],
  mistral: [{ key: "apiKey", label: "Mistral API Key", type: "password" }],
};

const EMPTY: DeploymentInput = {
  name: "",
  provider: "bedrock",
  providerModelId: "",
  weight: 50,
  status: "active",
  timeoutMs: 30000,
  retryCount: 2,
  credentialsRef: "manual",
  mode: "",
  providerCredentials: {},
};

type SortKey = "name" | "createdBy" | "updatedAt" | "costs" | "chapterId" | "accessGroup";
type SortDir = "asc" | "desc";

function truncateId(id: string) {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

function sortRows(rows: Deployment[], key: SortKey | null, dir: SortDir): Deployment[] {
  if (!key) return rows;
  const sorted = [...rows];
  const sign = dir === "asc" ? 1 : -1;
  sorted.sort((a, b) => {
    let comparison = 0;
    switch (key) {
      case "name":
        comparison = a.name.localeCompare(b.name);
        break;
      case "createdBy":
        comparison = (a.createdBy ?? "").localeCompare(b.createdBy ?? "");
        break;
      case "updatedAt":
        comparison = a.updatedAt.localeCompare(b.updatedAt);
        break;
      case "costs":
        comparison = (a.costs?.input ?? 0) - (b.costs?.input ?? 0);
        break;
      case "chapterId":
        comparison = (a.chapterId ?? "").localeCompare(b.chapterId ?? "");
        break;
      case "accessGroup":
        comparison = (a.accessGroup ?? "").localeCompare(b.accessGroup ?? "");
        break;
    }
    return comparison * sign;
  });
  return sorted;
}

function ProviderIcon({ provider }: { provider: ProviderName }) {
  return (
    <span className="flex size-5 items-center justify-center rounded bg-muted text-[10px] font-semibold uppercase text-muted-foreground">
      {provider.slice(0, 2)}
    </span>
  );
}

function InfoIcon({ text }: { text: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Info className="size-3.5 cursor-help text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-xs">{text}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function FormRow({
  label,
  required,
  info,
  children,
  helper,
}: {
  label: string;
  required?: boolean;
  info?: string;
  children: React.ReactNode;
  helper?: React.ReactNode;
}) {
  return (
    <div className="grid gap-4 py-4 sm:grid-cols-[280px_1fr]">
      <div className="flex items-start gap-1.5 pt-2 text-sm font-medium">
        {required ? <span className="text-red-500">*</span> : null}
        <span>{label}</span>
        {info ? <InfoIcon text={info} /> : null}
      </div>
      <div className="space-y-1.5">
        {children}
        {helper ? <p className="text-xs text-muted-foreground">{helper}</p> : null}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold">{children}</h3>;
}

function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-9"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

function HeaderIcon({ label, info }: { label: string; info?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      {info ? <InfoIcon text={info} /> : null}
    </span>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 hover:text-foreground"
    >
      {label}
      <span className="inline-flex flex-col text-[9px] leading-[8px] text-muted-foreground">
        <span className={active && dir === "asc" ? "text-foreground" : ""}>▲</span>
        <span className={active && dir === "desc" ? "text-foreground" : ""}>▼</span>
      </span>
    </button>
  );
}

function PlaceholderSection({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-8 text-center">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function ModelsPage() {
  const qc = useQueryClient();
  const { data, isPending, refetch } = useQuery({
    queryKey: ["deployments"],
    queryFn: listDeployments,
  });
  const { data: credentials } = useQuery({ queryKey: ["credentials"], queryFn: listCredentials });
  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");
  const [chapter, setChapter] = useState("personal");
  const [view, setView] = useState("current");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DeploymentInput>(EMPTY);
  const [pendingDelete, setPendingDelete] = useState<Deployment | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["deployments"] });

  const save = useMutation({
    mutationFn: (input: DeploymentInput) =>
      editingId ? updateDeployment(editingId, input) : createDeployment(input),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      setForm(EMPTY);
      setActiveTab("all");
      toast.success(editingId ? "Model updated" : "Model created");
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteDeployment(id),
    onSuccess: () => {
      invalidate();
      setPendingDelete(null);
      toast.success("Model deleted");
    },
  });

  const toggle = useMutation({
    mutationFn: (row: Deployment) => {
      const { id, updatedAt: _updatedAt, ...rest } = row;
      return updateDeployment(id, {
        ...rest,
        status: row.status === "disabled" ? "active" : "disabled",
      });
    },
    onSuccess: () => invalidate(),
  });

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(1);
  }

  const filteredRows = useMemo(() => {
    return (data ?? []).filter((d) => {
      if (chapter !== "all" && d.chapterId && d.chapterId !== chapter) return false;
      if (view === "current" && chapter !== "all" && !d.chapterId) return false;
      if (
        search &&
        !`${d.name} ${d.providerModelId} ${d.credentialsRef}`
          .toLowerCase()
          .includes(search.toLowerCase())
      )
        return false;
      return true;
    });
  }, [data, chapter, view, search]);

  const sortedRows = useMemo(
    () => sortRows(filteredRows, sortKey, sortDir),
    [filteredRows, sortKey, sortDir],
  );

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const paginatedRows = sortedRows.slice(startIdx, startIdx + pageSize);
  const endIdx = Math.min(startIdx + paginatedRows.length, sortedRows.length);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY);
    setActiveTab("add");
  }

  function openEdit(row: Deployment) {
    const { id: _id, updatedAt: _u, ...rest } = row;
    setEditingId(row.id);
    setForm({
      ...EMPTY,
      ...rest,
      providerCredentials: row.providerCredentials ?? {},
      mode: row.mode ?? "",
    });
    setActiveTab("add");
  }

  function handleTabClick(tabId: string) {
    if (tabId === "add") {
      openCreate();
      return;
    }
    setActiveTab(tabId);
  }

  function updateProvider(provider: ProviderName) {
    setForm((f) => ({
      ...f,
      provider,
      credentialsRef: "manual",
      providerCredentials: {},
    }));
  }

  function updateCredentialField(key: string, value: string) {
    setForm((f) => ({
      ...f,
      providerCredentials: { ...f.providerCredentials, [key]: value },
    }));
  }

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY);
    setActiveTab("all");
  }

  const credentialOptions = [
    { value: "manual", label: "None" },
    ...(credentials ?? [])
      .filter((c) => c.provider === form.provider)
      .map((c) => ({ value: c.id, label: c.name })),
  ];

  const credentialFields = PROVIDER_CREDENTIAL_FIELDS[form.provider];

  return (
    <div className="space-y-4">
      <PageHeader title="Model Management" description="Add and manage models for the proxy" />

      <div className="border-b border-border">
        <nav className="flex flex-wrap items-center gap-1" aria-label="Model management sections">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabClick(tab.id)}
                className={`
                  relative inline-flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors
                  ${isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"}
                `}
              >
                {tab.label}
                {tab.badge ? (
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    {tab.badge}
                  </Badge>
                ) : null}
                {isActive ? (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>

      {activeTab === "all" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search model names..."
                className="h-8 pl-8 text-sm"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={chapter} onValueChange={(v) => { setChapter(v); setPage(1); }}>
                <SelectTrigger className="h-8 w-44 text-sm" aria-label="Chapter">
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-blue-500" />
                    Chapter
                  </span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHAPTERS.map((c) => (
                    <SelectItem key={c.value} value={c.value} className="text-sm">
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={view} onValueChange={(v) => { setView(v); setPage(1); }}>
                <SelectTrigger className="h-8 w-48 text-sm" aria-label="View">
                  <span className="text-muted-foreground">View</span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VIEWS.map((v) => (
                    <SelectItem key={v.value} value={v.value} className="text-sm">
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button variant="outline" size="icon" className="size-8" aria-label="Settings">
                <Settings className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                aria-label="Refresh"
                onClick={() => refetch()}
              >
                <RefreshCw className="size-4" />
              </Button>
              <Button variant="outline" size="sm" className="h-8 gap-1.5">
                <Columns3 className="size-4" />
                Columns
              </Button>
              <Button variant="outline" size="sm" className="h-8 gap-1.5">
                <SlidersHorizontal className="size-4" />
                Filters
              </Button>
            </div>
          </div>

          <DataTable
            loading={isPending}
            rows={paginatedRows}
            rowKey={(r) => r.id}
            onRowClick={openEdit}
            columns={[
              {
                key: "id",
                header: "Model ID",
                cell: (r) => (
                  <span className="font-mono text-sm text-blue-600 hover:underline">
                    {truncateId(r.id)}
                  </span>
                ),
              },
              {
                key: "model",
                header: (
                  <HeaderIcon
                    label="Model Information"
                    info="Gateway-facing model name and provider model ID"
                  />
                ),
                cell: (r) => (
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-md border border-border bg-muted">
                      <Boxes className="size-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="font-medium">{r.name}</div>
                      <div className="max-w-[240px] truncate font-mono text-xs text-muted-foreground">
                        {r.providerModelId}
                      </div>
                    </div>
                  </div>
                ),
              },
              {
                key: "credentials",
                header: (
                  <HeaderIcon
                    label="Credentials"
                    info="Credential source used to call the provider"
                  />
                ),
                cell: (r) => (
                  <Badge variant="outline" className="gap-1 font-normal text-foreground">
                    <Pencil className="size-3" />
                    {r.credentialsRef === "manual" ? "Manual" : r.credentialsRef}
                  </Badge>
                ),
              },
              {
                key: "createdBy",
                header: (
                  <SortHeader
                    label="Created By"
                    active={sortKey === "createdBy"}
                    dir={sortDir}
                    onClick={() => handleSort("createdBy")}
                  />
                ),
                cell: (r) => (
                  <div className="text-sm">
                    <div>{r.createdBy ?? "Unknown"}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.createdAt ? dateTime(r.createdAt) : "Unknown date"}
                    </div>
                  </div>
                ),
              },
              {
                key: "updatedAt",
                header: (
                  <SortHeader
                    label="Updated At"
                    active={sortKey === "updatedAt"}
                    dir={sortDir}
                    onClick={() => handleSort("updatedAt")}
                  />
                ),
                className: "tabular-nums",
                cell: (r) => (
                  <span className="text-sm text-muted-foreground">{dateTime(r.updatedAt)}</span>
                ),
              },
              {
                key: "costs",
                header: (
                  <SortHeader
                    label="Costs"
                    active={sortKey === "costs"}
                    dir={sortDir}
                    onClick={() => handleSort("costs")}
                  />
                ),
                cell: (r) => (
                  <div className="text-xs">
                    <div className="text-muted-foreground">
                      IN{" "}
                      <span className="font-medium text-foreground">
                        {currency(r.costs?.input ?? 0)}
                      </span>
                    </div>
                    <div className="text-muted-foreground">
                      OUT{" "}
                      <span className="font-medium text-foreground">
                        {currency(r.costs?.output ?? 0)}
                      </span>
                    </div>
                  </div>
                ),
              },
              {
                key: "chapterId",
                header: (
                  <SortHeader
                    label="Chapter ID"
                    active={sortKey === "chapterId"}
                    dir={sortDir}
                    onClick={() => handleSort("chapterId")}
                  />
                ),
                cell: (r) => (
                  <span className="text-sm text-muted-foreground">{r.chapterId ?? "—"}</span>
                ),
              },
              {
                key: "accessGroup",
                header: (
                  <SortHeader
                    label="Model Access Group"
                    active={sortKey === "accessGroup"}
                    dir={sortDir}
                    onClick={() => handleSort("accessGroup")}
                  />
                ),
                cell: (r) => (
                  <span className="text-sm text-muted-foreground">{r.accessGroup ?? "—"}</span>
                ),
              },
              {
                key: "actions",
                header: "Actions",
                className: "text-right",
                cell: (r) => (
                  <div
                    className="flex items-center justify-end gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Switch
                      checked={r.status !== "disabled"}
                      onCheckedChange={() => toggle.mutate(r)}
                      aria-label="Toggle model"
                    />
                    <Button variant="ghost" size="sm" onClick={() => setPendingDelete(r)}>
                      Delete
                    </Button>
                  </div>
                ),
              },
            ]}
          />

          <div className="flex flex-col gap-4 rounded-md border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Rows per page</span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-20 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROWS_PER_PAGE_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)} className="text-sm">
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="text-sm text-muted-foreground">
              Showing {sortedRows.length === 0 ? 0 : startIdx + 1}-{endIdx} of {sortedRows.length}
              <span className="mx-3 text-border">|</span>
              Page {safePage} of {totalPages}
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                disabled={safePage <= 1}
                onClick={() => setPage(1)}
              >
                <ChevronFirst className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                <ChevronRight className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                disabled={safePage >= totalPages}
                onClick={() => setPage(totalPages)}
              >
                <ChevronLast className="size-4" />
              </Button>
            </div>
          </div>

          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" />
            <p>
              To access these models, create a Virtual Key without selecting a team on the{" "}
              <Link to="/keys" className="text-blue-600 hover:underline">
                Virtual Keys page
              </Link>
              .
            </p>
          </div>
        </>
      )}

      {activeTab === "add" && (
        <div className="rounded-md border border-border bg-card">
          <div className="border-b border-border p-4">
            <SectionTitle>{editingId ? "Edit Model" : "Add Model"}</SectionTitle>
          </div>

          <div className="divide-y divide-border px-4">
            <FormRow
              label="Provider"
              required
              info="The upstream model provider"
            >
              <Select value={form.provider} onValueChange={(v) => updateProvider(v as ProviderName)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p}>
                      <span className="flex items-center gap-2">
                        <ProviderIcon provider={p} />
                        {PROVIDER_LABELS[p]}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormRow>

            <FormRow
              label="Provider Model Name(s)"
              required
              info="The model name sent to the upstream LLM API"
              helper="The model name sent to the upstream LLM API"
            >
              <Input
                value={form.providerModelId}
                onChange={(e) => setForm({ ...form, providerModelId: e.target.value })}
                placeholder="Select models"
              />
            </FormRow>

            <FormRow
              label="Model Mappings"
              required
              info="Map public model names to provider model names"
            >
              <div className="rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="px-3 py-2 text-left font-medium">
                        <span className="inline-flex items-center gap-1">
                          Public Model Name <InfoIcon text="The name callers will use" />
                        </span>
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        <span className="inline-flex items-center gap-1">
                          Provider Model Name <InfoIcon text="The provider model ID" />
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        <Input
                          value={form.name}
                          onChange={(e) => setForm({ ...form, name: e.target.value })}
                          placeholder="Public model name"
                          className="h-8"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={form.providerModelId}
                          onChange={(e) => setForm({ ...form, providerModelId: e.target.value })}
                          placeholder="Provider model ID"
                          className="h-8"
                        />
                      </td>
                    </tr>
                    {form.name || form.providerModelId ? null : (
                      <tr>
                        <td colSpan={2} className="px-3 py-8 text-center text-sm text-muted-foreground">
                          <Boxes className="mx-auto mb-2 size-8 text-muted-foreground/50" />
                          No data
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </FormRow>

            <FormRow
              label="Mode"
              info="Provider endpoint to use when health checking this model"
              helper={
                <>
                  <span className="font-medium text-foreground">Optional</span> — Provider endpoint
                  to use when health checking this model{" "}
                  <a href="#" className="text-blue-600 hover:underline">
                    Learn more
                  </a>
                </>
              }
            >
              <Select
                value={form.mode || ""}
                onValueChange={(v) => setForm({ ...form, mode: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormRow>

            <div className="py-4">
              <p className="text-sm text-muted-foreground">
                Either select existing credentials OR enter new provider credentials below
              </p>
            </div>

            <FormRow label="Existing Credentials" info="Choose from saved credential sets">
              <Select
                value={form.credentialsRef}
                onValueChange={(v) => setForm({ ...form, credentialsRef: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {credentialOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormRow>

            <div className="relative py-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-card px-2 text-sm text-muted-foreground">OR</span>
              </div>
            </div>

            {credentialFields.map((field) => (
              <FormRow key={field.key} label={field.label}>
                {field.type === "password" ? (
                  <PasswordInput
                    value={form.providerCredentials?.[field.key] ?? ""}
                    onChange={(v) => updateCredentialField(field.key, v)}
                    placeholder="Type..."
                  />
                ) : (
                  <Input
                    value={form.providerCredentials?.[field.key] ?? ""}
                    onChange={(e) => updateCredentialField(field.key, e.target.value)}
                    placeholder="Type..."
                  />
                )}
              </FormRow>
            ))}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border p-4">
            <Button variant="outline" onClick={resetForm}>
              Cancel
            </Button>
            <Button
              onClick={() => save.mutate(form)}
              disabled={!form.name || !form.providerModelId || save.isPending}
            >
              {save.isPending ? "Saving…" : editingId ? "Save changes" : "Add Model"}
            </Button>
          </div>
        </div>
      )}

      {activeTab === "auto-routers" && (
        <PlaceholderSection
          title="Auto-Routers"
          description="Automatic model routing and failover configuration will appear here."
        />
      )}

      {activeTab === "credentials" && (
        <PlaceholderSection
          title="LLM Credentials"
          description="Manage reusable credential sets for model providers."
        />
      )}

      {activeTab === "pass-through" && (
        <PlaceholderSection
          title="Pass-Through Endpoints"
          description="Configure pass-through endpoints for provider-native APIs."
        />
      )}

      {activeTab === "health" && (
        <PlaceholderSection
          title="Health Status"
          description="View model and provider health checks."
        />
      )}

      {activeTab === "retry" && (
        <PlaceholderSection
          title="Model Retry Settings"
          description="Configure default retry policies per model."
        />
      )}

      {activeTab === "alias" && (
        <PlaceholderSection
          title="Model Group Alias"
          description="Group models under friendly aliases."
        />
      )}

      {activeTab === "price" && (
        <PlaceholderSection
          title="Price Data Reload"
          description="Reload and refresh model pricing data."
        />
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title="Delete model"
        description={`This removes ${pendingDelete?.name ?? ""} from the routing pool. Requests targeting it will fail.`}
        confirmLabel="Delete"
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
      />
    </div>
  );
}
