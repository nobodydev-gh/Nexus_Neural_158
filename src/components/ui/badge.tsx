import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  tone = "muted",
  children,
}: {
  className?: string;
  tone?: "muted" | "sage" | "high" | "med" | "low" | "none";
  children: ReactNode;
}) {
  const tones = {
    muted: "border-border text-muted",
    sage: "border-sage/40 text-sage",
    high: "border-conf-high/40 text-conf-high",
    med: "border-conf-med/40 text-conf-med",
    low: "border-conf-low/40 text-conf-low",
    none: "border-conf-none/40 text-conf-none",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
