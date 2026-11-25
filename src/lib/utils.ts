import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelativeTime(date: Date | string): string {
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export function severityColor(severity: "critical" | "warning" | "suggestion" | "praise") {
  return {
    critical: "text-red-400 bg-red-950/40 border-red-800",
    warning: "text-amber-400 bg-amber-950/40 border-amber-800",
    suggestion: "text-blue-400 bg-blue-950/40 border-blue-800",
    praise: "text-emerald-400 bg-emerald-950/40 border-emerald-800",
  }[severity];
}
