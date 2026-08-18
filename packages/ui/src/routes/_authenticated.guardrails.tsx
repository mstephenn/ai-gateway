import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/console/PageHeader";
import { DataTable } from "@/components/console/DataTable";
import { ConfirmDialog } from "@/components/console/ConfirmDialog";
import { DetailDrawer, Field } from "@/components/console/DetailDrawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createGuardrailRule,
  deleteGuardrailRule,
  listGuardrailRules,
  updateGuardrailRule,
  type GuardrailRule,
} from "@/lib/api/guardrails";
import { ApiError } from "@/lib/api/client";
import { dateTime } from "@/lib/format";
import type { GuardrailRuleType, JsonValue } from "@ai-gateway/shared";

export const Route = createFileRoute("/_authenticated/guardrails")({
  head: () => ({
    meta: [
      { title: "Guardrails — AI Gateway Admin Console" },
      { name: "description", content: "Manage content safety and policy guardrails." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Guardrails — AI Gateway Admin Console" },
      { property: "og:description", content: "Create, edit and enable guardrail rules." },
    ],
  }),
  component: GuardrailsPage,
});

const RULE_TYPES: { value: GuardrailRuleType; label: string }[] = [
  { value: "keyword_block", label: "Keyword block" },
  { value: "pii_mask", label: "PII mask" },
  { value: "moderation", label: "Moderation" },
];

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  RULE_TYPES.map((t) => [t.value, t.label]),
);

interface GuardrailForm {
  name: string;
  type: GuardrailRuleType;
  enabled: boolean;
  keywords: string;
  caseSensitive: boolean;
}

const EMPTY: GuardrailForm = {
  name: "",
  type: "keyword_block",
  enabled: true,
  keywords: "",
  caseSensitive: false,
};

function formToConfig(form: GuardrailForm): { config: JsonValue; valid: boolean; error?: string } {
  if (form.type === "keyword_block") {
    const keywords = form.keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (keywords.length === 0) {
      return { config: {}, valid: false, error: "At least one keyword is required." };
    }
    return {
      config: { keywords, caseSensitive: form.caseSensitive },
      valid: true,
    };
  }
  return { config: {}, valid: true };
}

function formFromRule(rule: GuardrailRule): GuardrailForm {
  const config = (rule.config ?? {}) as { keywords?: string[]; caseSensitive?: boolean };
  return {
    name: rule.name,
    type: rule.type,
    enabled: rule.enabled,
    keywords: Array.isArray(config.keywords) ? config.keywords.join(", ") : "",
    caseSensitive: config.caseSensitive === true,
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

export default function GuardrailsPage() {
  const queryClient = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<GuardrailRule | null>(null);
  const [form, setForm] = useState<GuardrailForm>(EMPTY);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ["guardrails"],
    queryFn: listGuardrailRules,
  });

  const create = useMutation({
    mutationFn: createGuardrailRule,
    onSuccess: () => {
      toast.success("Guardrail rule created");
      setDrawerOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["guardrails"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateGuardrailRule>[1] }) =>
      updateGuardrailRule(id, input),
    onSuccess: () => {
      toast.success("Guardrail rule updated");
      setDrawerOpen(false);
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["guardrails"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: deleteGuardrailRule,
    onSuccess: () => {
      toast.success("Guardrail rule deleted");
      setDeleteId(null);
      void queryClient.invalidateQueries({ queryKey: ["guardrails"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setDrawerOpen(true);
  }

  function openEdit(rule: GuardrailRule) {
    setEditing(rule);
    setForm(formFromRule(rule));
    setDrawerOpen(true);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { config, valid, error } = formToConfig(form);
    if (!valid) {
      toast.error(error);
      return;
    }
    const input = {
      name: form.name.trim(),
      type: form.type,
      enabled: form.enabled,
      config,
    };
    if (editing) {
      update.mutate({ id: editing.id, input });
    } else {
      create.mutate(input);
    }
  }

  const columns = [
    {
      key: "name",
      header: "Name",
      cell: (r: GuardrailRule) => <span className="font-medium">{r.name}</span>,
    },
    {
      key: "type",
      header: "Type",
      cell: (r: GuardrailRule) => TYPE_LABEL[r.type] ?? r.type,
    },
    {
      key: "enabled",
      header: "Status",
      cell: (r: GuardrailRule) => (
        <span
          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${
            r.enabled
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {r.enabled ? "Enabled" : "Disabled"}
        </span>
      ),
    },
    {
      key: "updated",
      header: "Updated",
      cell: (r: GuardrailRule) => dateTime(r.updatedAt),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Guardrails"
        description="Content safety and policy controls for requests."
        actions={
          <Button onClick={openCreate}>
            <Plus className="mr-1.5 size-4" /> Add rule
          </Button>
        }
      />

      <DataTable
        columns={columns}
        rows={rules}
        loading={isLoading}
        rowKey={(r) => r.id}
        onRowClick={openEdit}
      />

      <DetailDrawer
        open={drawerOpen}
        onOpenChange={(open) => {
          setDrawerOpen(open);
          if (!open) setEditing(null);
        }}
        title={editing ? "Edit guardrail rule" : "Create guardrail rule"}
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Name">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Block internal codenames"
            />
          </Field>

          <Field label="Type">
            <Select
              value={form.type}
              onValueChange={(v) => setForm({ ...form, type: v as GuardrailRuleType })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RULE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {form.type === "keyword_block" ? (
            <>
              <Field label="Keywords">
                <Input
                  value={form.keywords}
                  onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                  placeholder="secret, classified, internal-use"
                />
                <p className="text-[11px] text-muted-foreground">Comma-separated list</p>
              </Field>
              <Field label="Case sensitive">
                <Switch
                  checked={form.caseSensitive}
                  onCheckedChange={(v) => setForm({ ...form, caseSensitive: v })}
                />
              </Field>
            </>
          ) : null}

          <Field label="Enabled">
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => setForm({ ...form, enabled: v })}
            />
          </Field>

          <div className="flex items-center gap-2 pt-2">
            <Button type="submit" className="flex-1">
              {editing ? "Save changes" : "Create rule"}
            </Button>
            {editing ? (
              <Button type="button" variant="destructive" onClick={() => setDeleteId(editing.id)}>
                Delete
              </Button>
            ) : null}
          </div>
        </form>
      </DetailDrawer>

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete guardrail rule?"
        description="This rule will stop applying immediately. You can recreate it later."
        confirmLabel="Delete"
        onConfirm={() => deleteId && remove.mutate(deleteId)}
      />
    </div>
  );
}
