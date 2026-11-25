"use client";

import { cn, severityColor } from "@/lib/utils";
import { AlertTriangle, AlertCircle, Lightbulb, ThumbsUp, ChevronDown } from "lucide-react";
import { useState } from "react";

interface Comment {
  path: string;
  line: number;
  severity: "critical" | "warning" | "suggestion" | "praise";
  title: string;
  body: string;
}

const severityIcon = {
  critical: AlertCircle,
  warning: AlertTriangle,
  suggestion: Lightbulb,
  praise: ThumbsUp,
};

export function CommentCard({ comment }: { comment: Comment }) {
  const [expanded, setExpanded] = useState(comment.severity === "critical");
  const Icon = severityIcon[comment.severity];
  const colors = severityColor(comment.severity);

  return (
    <div className={cn("rounded-xl border p-4 space-y-2 transition-all", colors)}>
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-2 text-left"
      >
        <Icon className="w-4 h-4 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{comment.title}</p>
          <p className="text-xs opacity-70 font-mono">
            {comment.path}:{comment.line}
          </p>
        </div>
        <ChevronDown
          className={cn(
            "w-4 h-4 shrink-0 transition-transform opacity-60",
            expanded && "rotate-180"
          )}
        />
      </button>

      {expanded && (
        <p className="text-sm opacity-90 leading-relaxed pl-6 whitespace-pre-wrap border-t border-current/10 pt-2">
          {comment.body}
        </p>
      )}
    </div>
  );
}
