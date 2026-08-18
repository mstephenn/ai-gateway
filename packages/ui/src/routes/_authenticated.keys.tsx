import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/console/ConfirmDialog";
import { DataTable } from "@/components/console/DataTable";
import { DetailDrawer, DetailRow, Field } from "@/components/console/DetailDrawer";
import { FilterBar, FilterSelect, SearchInput } from "@/components/console/FilterBar";
import { PageHeader } from "@/components/console/PageHeader";
import { StatusBadge } from "@/components/console/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  updateApiKey,
  type CreateKeyInput,
  type KeySecretResult,
  type UpdateKeyInput,
} from "@/lib/api/keys";
import { listTeams } from "@/lib/api/teams";
import { listUsers } from "@/lib/api/org";
import { compactNumber, dateTime, fullNumber, relativeTime } from "@/lib/format";
import type { ApiKey, KeyOwnerType } from "@/lib/mock-data/types";

export const Route = createFileRoute("/_authenticated/keys")({
  head: () => ({
    meta: [
      { title: "API keys - AI Gateway Admin Console" },
      {
        name: "description",
        content: "Create, rotate and revoke AI Gateway API keys with one-time secret reveal.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: KeysPage,
});

const EMPTY: CreateKeyInput = {
  name: "",
  ownerType: "team",
  ownerId: "",
  ownerName: "",
  expiresAt: null,
  budgetLimit: null,
  rpmLimit: null,
  tpmLimit: null,
  allowedModels: [],
};

function keyToForm(key: ApiKey): UpdateKeyInput {
  return {
    name: key.name,
    ownerType: key.ownerType,
    ownerId: key.ownerId,
    ownerName: key.ownerName,
    expiresAt: key.expiresAt,
    budgetLimit: key.budgetLimit,
    rpmLimit: key.rpmLimit,
    tpmLimit: key.tpmLimit,
    allowedModels: key.allowedModels,
  };
}

function parseNumberInput(value: string): number | null {
  return value === "" ? null : Number(value);
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function KeysPage() {
  const qc = useQueryClient();
  const { data: keys, isPending } = useQuery({ queryKey: ["apiKeys"], queryFn: listApiKeys });
  const { data: teams } = useQuery({ queryKey: ["teams"], queryFn: listTeams });
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [ownerType, setOwnerType] = useState("all");
  const [selected, setSelected] = useState<ApiKey | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<ApiKey | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateKeyInput>(EMPTY);
  const [editForm, setEditForm] = useState<UpdateKeyInput | null>(null);
  const [secretResult, setSecretResult] = useState<KeySecretResult | null>(null);

  const owners = useMemo(() => {
    const teamOwners = (teams ?? []).map((team) => ({
      id: team.id,
      name: team.name,
      type: "team" as const,
    }));
    const userOwners = (users ?? []).map((user) => ({
      id: user.id,
      name: user.name,
      type: "user" as const,
    }));
    return [...teamOwners, ...userOwners];
  }, [teams, users]);

  const rows = useMemo(
    () =>
      (keys ?? []).filter((key) => {
        if (status !== "all" && key.status !== status) return false;
        if (ownerType !== "all" && key.ownerType !== ownerType) return false;
        if (search) {
          const hay = `${key.name} ${key.prefix} ${key.ownerName}`.toLowerCase();
          if (!hay.includes(search.toLowerCase())) return false;
        }
        return true;
      }),
    [keys, ownerType, search, status],
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ["apiKeys"] });

  const create = useMutation({
    mutationFn: createApiKey,
    onSuccess: (result) => {
      invalidate();
      setSecretResult(result);
      setCreateOpen(false);
      setForm(EMPTY);
      toast.success("API key created");
    },
  });

  const rotate = useMutation({
    mutationFn: rotateApiKey,
    onSuccess: (result) => {
      invalidate();
      setSelected(result.key);
      setSecretResult(result);
      toast.success("API key rotated");
    },
  });

  const revoke = useMutation({
    mutationFn: revokeApiKey,
    onSuccess: () => {
      invalidate();
      setPendingRevoke(null);
      setSelected(null);
      toast.success("API key revoked");
    },
  });

  const saveKey = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateKeyInput }) => updateApiKey(id, input),
    onSuccess: (key) => {
      invalidate();
      setSelected(key);
      setEditForm(keyToForm(key));
      toast.success("API key updated");
    },
  });

  function openDetails(key: ApiKey) {
    setSelected(key);
    setEditForm(keyToForm(key));
  }

  function openCreate() {
    const firstOwner = owners[0];
    setForm({
      ...EMPTY,
      ownerType: firstOwner?.type ?? "team",
      ownerId: firstOwner?.id ?? "",
      ownerName: firstOwner?.name ?? "",
    });
    setCreateOpen(true);
  }

  function updateOwner(ownerId: string) {
    const owner = owners.find((entry) => entry.id === ownerId);
    setForm({
      ...form,
      ownerId,
      ownerName: owner?.name ?? "",
      ownerType: owner?.type ?? form.ownerType,
    });
  }

  function updateOwnerType(value: KeyOwnerType) {
    const owner = owners.find((entry) => entry.type === value);
    setForm({
      ...form,
      ownerType: value,
      ownerId: owner?.id ?? "",
      ownerName: owner?.name ?? "",
    });
  }

  async function copySecret(secret: string) {
    await navigator.clipboard.writeText(secret);
    toast.success("Secret copied");
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="API keys"
        description="Issue, rotate and revoke gateway keys. Secrets are shown once."
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" /> New key
          </Button>
        }
      />

      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search keys..." />
        <FilterSelect
          label="Status"
          value={status}
          onChange={setStatus}
          width="w-36"
          options={[
            { value: "all", label: "All statuses" },
            { value: "active", label: "Active" },
            { value: "revoked", label: "Revoked" },
            { value: "expired", label: "Expired" },
          ]}
        />
        <FilterSelect
          label="Owner"
          value={ownerType}
          onChange={setOwnerType}
          width="w-36"
          options={[
            { value: "all", label: "All owners" },
            { value: "team", label: "Teams" },
            { value: "user", label: "Users" },
          ]}
        />
      </FilterBar>

      <DataTable
        loading={isPending}
        rows={rows}
        rowKey={(row) => row.id}
        onRowClick={openDetails}
        columns={[
          {
            key: "name",
            header: "Key",
            cell: (row) => <span className="font-medium">{row.name}</span>,
          },
          {
            key: "prefix",
            header: "Prefix",
            cell: (row) => <span className="font-mono text-xs">{row.prefix}</span>,
          },
          { key: "owner", header: "Owner", cell: (row) => row.ownerName },
          {
            key: "type",
            header: "Type",
            cell: (row) => <span className="capitalize">{row.ownerType}</span>,
          },
          { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
          {
            key: "budget",
            header: "Budget",
            className: "tabular text-right",
            cell: (row) => (row.budgetLimit ? compactNumber(row.budgetLimit) : "Unlimited"),
          },
          {
            key: "rpm",
            header: "RPM",
            className: "tabular text-right",
            cell: (row) => (row.rpmLimit ? fullNumber(row.rpmLimit) : "Unlimited"),
          },
          { key: "last", header: "Last used", cell: (row) => relativeTime(row.lastUsedAt) },
          { key: "expires", header: "Expires", cell: (row) => dateTime(row.expiresAt) },
          {
            key: "actions",
            header: "",
            className: "text-right",
            cell: (row) => (
              <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => rotate.mutate(row.id)}
                  disabled={row.status === "revoked"}
                >
                  Rotate
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPendingRevoke(row)}
                  disabled={row.status === "revoked"}
                >
                  Revoke
                </Button>
              </div>
            ),
          },
        ]}
      />

      <DetailDrawer
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setEditForm(null);
          }
        }}
        title={selected?.name ?? "API key"}
        description="Key ownership, limits, policy and lifecycle controls."
        footer={
          selected && editForm ? (
            <>
              <Button
                size="sm"
                onClick={() => saveKey.mutate({ id: selected.id, input: editForm })}
                disabled={!editForm.name || saveKey.isPending || selected.status === "revoked"}
              >
                {saveKey.isPending ? "Saving..." : "Save changes"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => rotate.mutate(selected.id)}>
                <RotateCw className="size-4" /> Rotate
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setPendingRevoke(selected)}>
                Revoke key
              </Button>
            </>
          ) : null
        }
      >
        {selected && editForm ? (
          <div className="space-y-4">
            <div className="space-y-1">
              <DetailRow
                label="Prefix"
                value={<span className="font-mono">{selected.prefix}</span>}
              />
              <DetailRow label="Status" value={<StatusBadge status={selected.status} />} />
              <DetailRow label="Created" value={dateTime(selected.createdAt)} />
              <DetailRow label="Last used" value={dateTime(selected.lastUsedAt)} />
            </div>
            <Field label="Name">
              <Input
                value={editForm.name}
                onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Owner type">
                <Select
                  value={editForm.ownerType}
                  onValueChange={(value) => {
                    const owner = owners.find((entry) => entry.type === value);
                    setEditForm({
                      ...editForm,
                      ownerType: value as KeyOwnerType,
                      ownerId: owner?.id ?? "",
                      ownerName: owner?.name ?? "",
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="team">Team</SelectItem>
                    <SelectItem value="user">User</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Owner">
                <Select
                  value={editForm.ownerId}
                  onValueChange={(ownerId) => {
                    const owner = owners.find((entry) => entry.id === ownerId);
                    setEditForm({
                      ...editForm,
                      ownerId,
                      ownerName: owner?.name ?? "",
                      ownerType: owner?.type ?? editForm.ownerType,
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select owner" />
                  </SelectTrigger>
                  <SelectContent>
                    {owners
                      .filter((owner) => owner.type === editForm.ownerType)
                      .map((owner) => (
                        <SelectItem key={owner.id} value={owner.id}>
                          {owner.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Expiration">
              <Input
                type="date"
                value={editForm.expiresAt?.slice(0, 10) ?? ""}
                onChange={(event) =>
                  setEditForm({
                    ...editForm,
                    expiresAt: event.target.value ? `${event.target.value}T00:00:00Z` : null,
                  })
                }
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Budget">
                <Input
                  type="number"
                  value={editForm.budgetLimit ?? ""}
                  placeholder="Unlimited"
                  onChange={(event) =>
                    setEditForm({ ...editForm, budgetLimit: parseNumberInput(event.target.value) })
                  }
                />
              </Field>
              <Field label="RPM">
                <Input
                  type="number"
                  value={editForm.rpmLimit ?? ""}
                  placeholder="Unlimited"
                  onChange={(event) =>
                    setEditForm({ ...editForm, rpmLimit: parseNumberInput(event.target.value) })
                  }
                />
              </Field>
              <Field label="TPM">
                <Input
                  type="number"
                  value={editForm.tpmLimit ?? ""}
                  placeholder="Unlimited"
                  onChange={(event) =>
                    setEditForm({ ...editForm, tpmLimit: parseNumberInput(event.target.value) })
                  }
                />
              </Field>
            </div>
            <Field label="Allowed models">
              <Input
                value={editForm.allowedModels.join(", ")}
                placeholder="Empty allows all models"
                onChange={(event) =>
                  setEditForm({ ...editForm, allowedModels: parseCsv(event.target.value) })
                }
              />
            </Field>
          </div>
        ) : null}
      </DetailDrawer>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              Generate a gateway key. The secret will be shown once.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Name">
              <Input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Owner type">
                <Select
                  value={form.ownerType}
                  onValueChange={(value) => updateOwnerType(value as KeyOwnerType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="team">Team</SelectItem>
                    <SelectItem value="user">User</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Owner">
                <Select value={form.ownerId} onValueChange={updateOwner}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select owner" />
                  </SelectTrigger>
                  <SelectContent>
                    {owners
                      .filter((owner) => owner.type === form.ownerType)
                      .map((owner) => (
                        <SelectItem key={owner.id} value={owner.id}>
                          {owner.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Expiration">
              <Input
                type="date"
                value={form.expiresAt?.slice(0, 10) ?? ""}
                onChange={(event) =>
                  setForm({
                    ...form,
                    expiresAt: event.target.value ? `${event.target.value}T00:00:00Z` : null,
                  })
                }
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Budget">
                <Input
                  type="number"
                  value={form.budgetLimit ?? ""}
                  placeholder="Unlimited"
                  onChange={(event) =>
                    setForm({ ...form, budgetLimit: parseNumberInput(event.target.value) })
                  }
                />
              </Field>
              <Field label="RPM">
                <Input
                  type="number"
                  value={form.rpmLimit ?? ""}
                  placeholder="Unlimited"
                  onChange={(event) =>
                    setForm({ ...form, rpmLimit: parseNumberInput(event.target.value) })
                  }
                />
              </Field>
              <Field label="TPM">
                <Input
                  type="number"
                  value={form.tpmLimit ?? ""}
                  placeholder="Unlimited"
                  onChange={(event) =>
                    setForm({ ...form, tpmLimit: parseNumberInput(event.target.value) })
                  }
                />
              </Field>
            </div>
            <Field label="Allowed models">
              <Input
                value={form.allowedModels.join(", ")}
                placeholder="Empty allows all models"
                onChange={(event) =>
                  setForm({ ...form, allowedModels: parseCsv(event.target.value) })
                }
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => create.mutate(form)}
              disabled={!form.name || !form.ownerId || create.isPending}
            >
              {create.isPending ? "Creating..." : "Create key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!secretResult} onOpenChange={(open) => !open && setSecretResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy this secret now</DialogTitle>
            <DialogDescription>
              The full key cannot be retrieved after this dialog is closed.
            </DialogDescription>
          </DialogHeader>
          {secretResult ? (
            <div className="rounded-md border border-border bg-muted p-3">
              <div className="break-all font-mono text-sm text-foreground">
                {secretResult.secret}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSecretResult(null)}>
              Close
            </Button>
            <Button onClick={() => secretResult && copySecret(secretResult.secret)}>
              <Copy className="size-4" /> Copy secret
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!pendingRevoke}
        onOpenChange={(open) => !open && setPendingRevoke(null)}
        title="Revoke API key"
        description={`Revoking ${pendingRevoke?.name ?? "this key"} stops authentication immediately.`}
        confirmLabel="Revoke key"
        onConfirm={() => pendingRevoke && revoke.mutate(pendingRevoke.id)}
      />
    </div>
  );
}
