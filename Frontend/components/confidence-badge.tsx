// Frontend/components/confidence-badge.tsx
"use client"

type ConfidenceBadgeProps = {
  // Supports either 0–1 (e.g. 0.87) or 0–100 (e.g. 87)
  score: number | null | undefined
}

function getConfidenceMeta(normalized: number) {
  if (normalized >= 0.8) {
    return {
      bg: "bg-emerald-50",
      text: "text-emerald-700",
      border: "border-emerald-200",
      label: "High",
    }
  }

  if (normalized >= 0.6) {
    return {
      bg: "bg-amber-50",
      text: "text-amber-700",
      border: "border-amber-200",
      label: "Medium",
    }
  }

  return {
    bg: "bg-rose-50",
    text: "text-rose-700",
    border: "border-rose-200",
    label: "Low",
  }
}

export default function ConfidenceBadge({ score }: ConfidenceBadgeProps) {
  if (score == null || Number.isNaN(score)) {
    return (
      <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600">
        N/A
      </span>
    )
  }

  // Normalize: if people store 0–100 in DB, this still works
  const normalizedRaw = score > 1 ? score / 100 : score
  const clamped = Math.min(Math.max(normalizedRaw, 0), 1)
  const percent = Math.round(clamped * 100)
  const meta = getConfidenceMeta(clamped)

  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        meta.bg,
        meta.text,
        meta.border,
      ].join(" ")}
    >
      {percent}%
      <span className="ml-1 hidden sm:inline">({meta.label})</span>
    </span>
  )
}