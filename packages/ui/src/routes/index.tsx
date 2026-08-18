import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/api/auth";
import { readSession, writeSession } from "@/lib/session";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sign in — AI Gateway Admin Console" },
      {
        name: "description",
        content:
          "Authenticate with an admin bearer key to manage AI Gateway deployments, teams, keys and usage.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Sign in — AI Gateway Admin Console" },
      {
        property: "og:description",
        content: "Authenticate with an admin bearer key to manage the enterprise AI Gateway.",
      },
    ],
  }),
  component: SignInPage,
});

function SignInPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (readSession()) navigate({ to: "/overview" });
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const key = inputRef.current?.value.trim() ?? "";
    if (!key) {
      setError("Enter an admin bearer key.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const session = await signIn(key);
      writeSession(session);
      navigate({ to: "/overview" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar px-4 py-10">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded bg-primary text-xs font-bold text-primary-foreground">
            AG
          </div>
          <div className="leading-tight">
            <h1 className="text-sm font-semibold text-foreground">AI Gateway</h1>
            <p className="text-xs text-muted-foreground">Admin console</p>
          </div>
        </div>

        <form onSubmit={onSubmit} data-mounted={mounted} className="space-y-4">
          <div className="space-y-1.5">
            <Label
              htmlFor="bearer"
              className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              Admin bearer key
            </Label>
            <Input
              id="bearer"
              ref={inputRef}
              type="password"
              autoFocus
              placeholder="sk-admin-…"
              className="font-mono text-sm"
              aria-invalid={!!error}
            />
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Verifying…" : "Sign in"}
          </Button>
        </form>

        <div className="mt-5 flex items-start gap-2 rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Demo key: <span className="font-mono text-foreground">sk-admin-demo-0000</span>
          </span>
        </div>
      </div>
    </div>
  );
}
