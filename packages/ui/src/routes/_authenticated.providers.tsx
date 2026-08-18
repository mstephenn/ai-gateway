import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/console/PageHeader";
import { DataTable } from "@/components/console/DataTable";
import { ConfirmDialog } from "@/components/console/ConfirmDialog";
import { DetailDrawer, Field } from "@/components/console/DetailDrawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createCredential,
  deleteCredential,
  listCredentials,
  updateCredential,
  type ProviderCredential,
} from "@/lib/api/credentials";
import { ApiError } from "@/lib/api/client";
import { dateTime } from "@/lib/format";
import type { ProviderCredentialProvider } from "@ai-gateway/shared";

export const Route = createFileRoute("/_authenticated/providers")({
  head: () => ({
    meta: [
      { title: "Providers — AI Gateway Admin Console" },
      { name: "description", content: "Manage provider credentials used by deployments." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Providers — AI Gateway Admin Console" },
      { property: "og:description", content: "Create, edit and delete provider credentials." },
    ],
  }),
  component: ProvidersPage,
});

const PROVIDERS: { value: ProviderCredentialProvider; label: string }[] = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "bedrock", label: "Bedrock" },
  { value: "azure-openai", label: "Azure OpenAI" },
  { value: "gemini", label: "Gemini" },
];

const PROVIDER_LABEL: Record<string, string> = Object.fromEntries(
  PROVIDERS.map((p) => [p.value, p.label]),
);

interface CredentialForm {
  provider: ProviderCredentialProvider;
  name: string;
  apiKey: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  resourceName: string;
  apiVersion: string;
}

const EMPTY: CredentialForm = {
  provider: "openai",
  name: "",
  apiKey: "",
  accessKeyId: "",
  secretAccessKey: "",
  region: "",
  resourceName: "",
  apiVersion: "",
};

function configFromForm(form: CredentialForm): Record<string, string> {
  const config: Record<string, string> = {};
  if (form.provider === "bedrock") {
    if (form.accessKeyId) config["accessKeyId"] = form.accessKeyId;
    if (form.secretAccessKey) config["secretAccessKey"] = form.secretAccessKey;
    if (form.region) config["region"] = form.region;
  } else if (form.provider === "azure-openai") {
    if (form.apiKey) config["apiKey"] = form.apiKey;
    if (form.resourceName) config["resourceName"] = form.resourceName;
    if (form.apiVersion) config["apiVersion"] = form.apiVersion;
  } else {
    if (form.apiKey) config["apiKey"] = form.apiKey;
  }
  return config;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

function ProviderFields({
  form,
  setForm,
}: {
  form: CredentialForm;
  setForm: (f: CredentialForm) => void;
}) {
  const placeholder = "Leave blank to keep the existing value";
  if (form.provider === "bedrock") {
    return (
      <>
        <Field label="Access key ID">
          <Input
            value={form.accessKeyId}
            onChange={(e) => setForm({ ...form, accessKeyId: e.target.value })}
            placeholder={placeholder}
          />
        </Field>
        <Field label="Secret access key">
          <Input
            type="password"
            value={form.secretAccessKey}
            onChange={(e) => setForm({ ...form, secretAccessKey: e.target.value })}
            placeholder={placeholder}
          />
        </Field>
        <Field label="Region">
          <Input
            value={form.region}
            onChange={(e) => setForm({ ...form, region: e.target.value })}
            placeholder={placeholder}
          />
        </Field>
      </>
    );
  }
  if (form.provider === "azure-openai") {
    return (
      <>
        <Field label="API key">
          <Input
            type="password"
            value={form.apiKey}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            placeholder={placeholder}
          />
        </Field>
        <Field label="Resource name">
          <Input
            value={form.resourceName}
            onChange={(e) => setForm({ ...form, resourceName: e.target.value })}
            placeholder={placeholder}
          />
        </Field>
        <Field label="API version">
          <Input
            value={form.apiVersion}
            onChange={(e) => setForm({ ...form, apiVersion: e.target.value })}
            placeholder={placeholder}
          />
        </Field>
      </>
    );
  }
  return (
    <Field label="API key">
      <Input
        type="password"
        value={form.apiKey}
        onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
        placeholder={placeholder}
      />
    </Field>
  );
}

function ProvidersPage() {
  const qc = useQueryClient();
  const { data, isPending } = useQuery({ queryKey: ["credentials"], queryFn: listCredentials });
  const [editing, setEditing] = useState<ProviderCredential | null>(null);
  const [form, setForm] = useState<CredentialForm>(EMPTY);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ProviderCredential | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["credentials"] });

  const save = useMutation({
    mutationFn: (input: CredentialForm) => {
      const config = configFromForm(input);
      if (editing) {
        const body =
          Object.keys(config).length > 0 ? { name: input.name, config } : { name: input.name };
        return updateCredential(editing.id, body);
      }
      return createCredential({ provider: input.provider, name: input.name, config });
    },
    onSuccess: () => {
      invalidate();
      setDrawerOpen(false);
      toast.success(editing ? "Credential updated" : "Credential created");
    },
    onError: (err) => {
      toast.error(errorMessage(err));
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteCredential(id),
    onSuccess: () => {
      invalidate();
      setPendingDelete(null);
      toast.success("Credential deleted");
    },
    onError: (err) => {
      toast.error(errorMessage(err));
    },
  });

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setDrawerOpen(true);
  }

  function openEdit(row: ProviderCredential) {
    setEditing(row);
    setForm({ ...EMPTY, provider: row.provider, name: row.name });
    setDrawerOpen(true);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Providers"
        description="Credentials deployments use to reach upstream model providers."
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" /> New credential
          </Button>
        }
      />

      <DataTable
        loading={isPending}
        rows={data ?? []}
        rowKey={(r) => r.id}
        onRowClick={openEdit}
        columns={[
          {
            key: "name",
            header: "Name",
            cell: (r) => <span className="font-medium">{r.name}</span>,
          },
          {
            key: "provider",
            header: "Provider",
            cell: (r) => (
              <span className="text-xs text-muted-foreground">
                {PROVIDER_LABEL[r.provider] ?? r.provider}
              </span>
            ),
          },
          { key: "updatedAt", header: "Updated", cell: (r) => dateTime(r.updatedAt) },
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
        title={editing ? `Edit ${editing.name}` : "New credential"}
        description="Secrets are encrypted at rest and never shown after creation."
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setDrawerOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => save.mutate(form)} disabled={!form.name}>
              {save.isPending ? "Saving…" : "Save credential"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Provider">
            <Select
              value={form.provider}
              onValueChange={(v) => setForm({ ...form, provider: v as ProviderCredentialProvider })}
              disabled={!!editing}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <ProviderFields form={form} setForm={setForm} />
        </div>
      </DetailDrawer>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title="Delete credential"
        description={`Deleting ${pendingDelete?.name ?? ""} will fail if any deployment still references it.`}
        confirmLabel="Delete credential"
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
      />
    </div>
  );
}
