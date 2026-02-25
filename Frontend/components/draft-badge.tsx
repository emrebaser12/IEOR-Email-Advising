"use client";

import { cn } from "@/lib/utils";

type DraftBadgeProps = {
  className?: string;
};

export default function DraftBadge({ className }: DraftBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-amber-100 text-[10px] leading-none",
        "text-amber-700 border border-amber-200 w-4 h-4 shrink-0",
        className,
      )}
      title="Saved draft"
      aria-label="Saved draft"
    >
      <span className="leading-none">📝</span>
    </span>
  );
}
