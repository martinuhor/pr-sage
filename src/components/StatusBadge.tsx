"use client";

import { cn } from "@/lib/utils";
import { CheckCircle, Loader2, Upload, Search } from "lucide-react";

type Status = "analyzing" | "reviewing" | "posting" | "done";

const config: Record<Status, { label: string; color: string; Icon: React.ElementType }> = {
  analyzing: {
    label: "Analyzing",
    color: "text-blue-400 bg-blue-950/40 border-blue-900",
    Icon: Search,
  },
  reviewing: {
    label: "Reviewing",
    color: "text-violet-400 bg-violet-950/40 border-violet-900",
    Icon: Loader2,
  },
  posting: {
    label: "Posting",
    color: "text-amber-400 bg-amber-950/40 border-amber-900",
    Icon: Upload,
  },
  done: {
    label: "Done",
    color: "text-emerald-400 bg-emerald-950/40 border-emerald-900",
    Icon: CheckCircle,
  },
};

export function StatusBadge({ status }: { status: Status }) {
  const { label, color, Icon } = config[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium",
        color
      )}
    >
      <Icon className={cn("w-3 h-3", status === "reviewing" && "animate-spin")} />
      {label}
    </span>
  );
}
