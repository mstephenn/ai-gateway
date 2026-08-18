import { useEffect, useState } from "react";
import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ConsoleShell } from "@/components/console/ConsoleShell";
import { readSession } from "@/lib/session";
import type { AdminSession } from "@/lib/api/auth";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const navigate = useNavigate();
  const [session, setSession] = useState<AdminSession | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const s = readSession();
    setSession(s);
    setChecked(true);
    if (!s) navigate({ to: "/" });
  }, [navigate]);

  if (!checked || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading console…</p>
      </div>
    );
  }

  return (
    <ConsoleShell session={session}>
      <Outlet />
    </ConsoleShell>
  );
}
