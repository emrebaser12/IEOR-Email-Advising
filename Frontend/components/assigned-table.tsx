"use client";

import { useState, Fragment } from "react";
import { Email } from "./emails-tab";
import { CheckSquare, Square } from "lucide-react";
import DraftBadge from "./draft-badge";

type SortField = "student" | "uni" | "subject" | "status" | "assigned" | "confidence" | "received";
type SortOrder = "asc" | "desc" | null;

function getPreviewText(body: string, maxLength = 180): string {
  const stripped = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (stripped.length <= maxLength) return stripped;
  const truncated = stripped.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 80 ? truncated.slice(0, lastSpace) : truncated) + "…";
}

type AssignedTableProps = {
  emails?: Email[];
  assignedPersons?: Record<number, string>;
  onUnassign: (emailId: number) => void;
  onSelect: (email: Email) => void;
  savedDrafts?: Record<number, string>;
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
  showPreview?: boolean;
};

function statusLabel(status: string): { label: string; className: string } {
  switch (status) {
    case "review":   return { label: "Needs Review",  className: "bg-yellow-100 text-yellow-800" };
    case "auto":     return { label: "Pending Send",  className: "bg-blue-100 text-blue-800" };
    case "sent":     return { label: "Sent",          className: "bg-green-100 text-green-800" };
    case "personal": return { label: "Personal",      className: "bg-red-100 text-red-800" };
    default:         return { label: status,          className: "bg-muted text-muted-foreground" };
  }
}

function formatDate(timestamp: string) {
  const iso = timestamp.endsWith("Z") || timestamp.includes("+") ? timestamp : timestamp + "Z";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function SortIcon({ field, sortField, sortOrder }: { field: SortField; sortField: SortField | null; sortOrder: SortOrder }) {
  if (sortField !== field) return <span className="ml-1 text-muted-foreground text-xs">↕</span>;
  if (sortOrder === "asc") return <span className="ml-1 text-blue-600 text-xs">↑</span>;
  if (sortOrder === "desc") return <span className="ml-1 text-blue-600 text-xs">↓</span>;
  return <span className="ml-1 text-muted-foreground text-xs">↕</span>;
}

export default function AssignedTable({
  emails = [],
  assignedPersons = {},
  onUnassign,
  onSelect,
  savedDrafts = {},
  selectedIds = new Set(),
  onToggleSelect,
  showPreview = false,
}: AssignedTableProps) {
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>(null);

  function handleSort(field: SortField) {
    if (sortField === field) {
      if (sortOrder === "asc") setSortOrder("desc");
      else if (sortOrder === "desc") { setSortField(null); setSortOrder(null); }
      else setSortOrder("asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  }

  const sortedEmails = [...emails].sort((a, b) => {
    if (!sortField || !sortOrder) return 0;
    let valA: string | number;
    let valB: string | number;
    switch (sortField) {
      case "student":  valA = (a.student_name ?? "").toLowerCase(); valB = (b.student_name ?? "").toLowerCase(); break;
      case "uni":      valA = (a.uni ?? "").toLowerCase();          valB = (b.uni ?? "").toLowerCase();          break;
      case "subject":  valA = a.subject.toLowerCase();              valB = b.subject.toLowerCase();              break;
      case "status":   valA = a.status;                             valB = b.status;                             break;
      case "assigned": valA = (assignedPersons[a.id] ?? "").toLowerCase(); valB = (assignedPersons[b.id] ?? "").toLowerCase(); break;
      case "confidence": valA = a.confidence; valB = b.confidence; break;
      case "received":
        valA = new Date(a.received_at.endsWith("Z") || a.received_at.includes("+") ? a.received_at : a.received_at + "Z").getTime();
        valB = new Date(b.received_at.endsWith("Z") || b.received_at.includes("+") ? b.received_at : b.received_at + "Z").getTime();
        break;
      default: return 0;
    }
    if (valA < valB) return sortOrder === "asc" ? -1 : 1;
    if (valA > valB) return sortOrder === "asc" ? 1 : -1;
    return 0;
  });

  if (emails.length === 0) {
    return <div className="text-sm text-muted-foreground">No assigned emails.</div>;
  }

  const thClass = "px-4 py-2 text-left cursor-pointer select-none hover:bg-muted/70 whitespace-nowrap";

  return (
    <div className="overflow-auto h-full rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted sticky top-0 z-10">
          <tr>
            {onToggleSelect && (
              <th className="px-4 py-2 text-left w-10">
                <span className="sr-only">Select</span>
              </th>
            )}
            <th className={thClass} onClick={() => handleSort("student")}>
              Student <SortIcon field="student" sortField={sortField} sortOrder={sortOrder} />
            </th>
            <th className={thClass} onClick={() => handleSort("uni")}>
              UNI <SortIcon field="uni" sortField={sortField} sortOrder={sortOrder} />
            </th>
            <th className={thClass} onClick={() => handleSort("subject")}>
              Subject <SortIcon field="subject" sortField={sortField} sortOrder={sortOrder} />
            </th>
            <th className={thClass} onClick={() => handleSort("status")}>
              Status <SortIcon field="status" sortField={sortField} sortOrder={sortOrder} />
            </th>
            <th className={thClass} onClick={() => handleSort("assigned")}>
              Assigned To <SortIcon field="assigned" sortField={sortField} sortOrder={sortOrder} />
            </th>
            <th className={thClass} onClick={() => handleSort("confidence")}>
              Confidence <SortIcon field="confidence" sortField={sortField} sortOrder={sortOrder} />
            </th>
            <th className={thClass} onClick={() => handleSort("received")}>
              Received <SortIcon field="received" sortField={sortField} sortOrder={sortOrder} />
            </th>
            <th className="px-4 py-2 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sortedEmails.map((email) => {
            const { label, className } = statusLabel(email.status);
            const assigned = assignedPersons[email.id] ?? "—";
            const hasDraft = !!savedDrafts[email.id];
            const isSelected = selectedIds.has(email.id);

            return (
              <Fragment key={email.id}>
              <tr
                className={`border-t border-border transition-colors ${
                  isSelected
                    ? "bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/30 dark:hover:bg-blue-900/50"
                    : "hover:bg-muted/40"
                }`}
              >
                {onToggleSelect && (
                  <td className="px-3 py-2">
                    <button
                      onClick={() => onToggleSelect(email.id)}
                      className="p-1 rounded hover:bg-muted"
                      aria-label={isSelected ? "Deselect" : "Select"}
                    >
                      {isSelected ? (
                        <CheckSquare className="h-4 w-4 text-blue-600" />
                      ) : (
                        <Square className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                  </td>
                )}
                <td className="px-4 py-2">
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="truncate">{email.student_name ?? "Unknown"}</span>
                    {hasDraft && <DraftBadge />}
                  </div>
                </td>
                <td className="px-4 py-2 whitespace-nowrap">{email.uni ?? "—"}</td>
                <td className="px-4 py-2 min-w-0">
                  <span className="block truncate" title={email.subject}>{email.subject}</span>
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
                    {label}
                  </span>
                </td>
                <td className="px-4 py-2 font-medium whitespace-nowrap">{assigned}</td>
                <td className="px-4 py-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      email.confidence < 0.6
                        ? "bg-red-100 text-red-800"
                        : email.confidence < 0.8
                        ? "bg-yellow-100 text-yellow-800"
                        : email.confidence < 0.95
                        ? "bg-green-100 text-green-800"
                        : "bg-green-200 text-green-900"
                    }`}
                  >
                    {(email.confidence * 100).toFixed(0)}%
                  </span>
                </td>
                <td className="px-4 py-2 whitespace-nowrap">{formatDate(email.received_at)}</td>
                <td className="px-4 py-2 space-x-2 w-44 whitespace-nowrap">
                  <button
                    onClick={() => onSelect(email)}
                    className="px-3 py-1 rounded-md text-xs font-medium bg-muted text-foreground hover:bg-muted/70"
                  >
                    View
                  </button>
                  <button
                    onClick={() => onUnassign(email.id)}
                    className="px-3 py-1 rounded-md text-xs font-medium bg-orange-500 text-white hover:bg-orange-600"
                  >
                    Unassign
                  </button>
                </td>
              </tr>
              {showPreview && (
                <tr className={isSelected ? "bg-blue-50 dark:bg-blue-900/20" : "bg-muted/10"}>
                  <td colSpan={100} className="px-4 pb-2 pt-0 text-xs text-muted-foreground leading-relaxed">
                    {getPreviewText(email.body)}
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
