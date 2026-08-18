import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "danger" | "neutral" | "info";

const TONES: Record<string, Tone> = {
  active: "success",
  operational: "success",
  success: "success",
  healthy: "success",
  degraded: "warning",
  partial: "warning",
  invited: "info",
  rate_limited: "warning",
  timeout: "warning",
  warning: "warning",
  disabled: "neutral",
  deactivated: "neutral",
  revoked: "danger",
  expired: "danger",
  suspended: "danger",
  outage: "danger",
  error: "danger",
  failed: "danger",
  critical: "danger",
  exceeded: "danger",
};

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-success/12 text-success border-success/30",
  warning: "bg-warning/15 text-warning-foreground border-warning/40",
  danger: "bg-destructive/12 text-destructive border-destructive/30",
  info: "bg-info/12 text-info border-info/30",
  neutral: "bg-muted text-muted-foreground border-border-strong",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const tone = TONES[status] ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize leading-4",
        TONE_CLASS[tone],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {status.replace(/_/g, " ")}
    </span>
  );
}
