"use client";

import { useState, Fragment } from "react";
import { Email } from "./emails-tab";
import { CheckSquare, Square, Send } from "lucide-react";
import DraftBadge from "./draft-badge";
import { ADVISORS } from "@/lib/constants";

type SortField = "student" | "uni" | "subject" | "assigned" | "confidence" | "received" | "sent";
type SortOrder = "asc" | "desc" | null;

function getPreviewText(body: string, maxLength = 180): string {
  const stripped = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (stripped.length <= maxLength) return stripped;
  const truncated = stripped.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 80 ? truncated.slice(0, lastSpace) : truncated) + "…";
}

type AutoSentTableProps = {
  emails?: Email[];
  searchTerm?: string;
  onDelete: (id: number) => void;
  onSelect: (email: Email) => void;
  onSend?: (id: number) => void;
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
  sending?: boolean;
  savedDrafts?: Record<number, string>;
  mode?: "pending" | "sent";
  assignedPersons?: Record<number, string>;
  onAssignPerson?: (emailId: number, person: string) => void;
  showPreview?: boolean;
};

function formatEastern(timestamp?: string | null) {
  if (!timestamp) return "—";

  const iso =
    timestamp.endsWith("Z") || timestamp.includes("+")
      ? timestamp
      : timestamp + "Z";

  const date = new Date(iso);

  return date.toLocaleString("en-US", {
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

export default function AutoSentTable({
  emails = [],
  onDelete,
  onSelect,
  onSend,
  selectedIds = new Set(),
  onToggleSelect,
  sending = false,
  savedDrafts = {},
  mode = "pending",
  assignedPersons = {},
  onAssignPerson,
  showPreview = false,
}: AutoSentTableProps) {
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>(null);

  function handleSort(field: SortField) {
    if (sortField === field) {
      if (sortOrder === "asc") {
        setSortOrder("desc");
      } else if (sortOrder === "desc") {
        setSortField(null);
        setSortOrder(null);
      } else {
        setSortOrder("asc");
      }
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
      case "student":
        valA = (a.student_name ?? "").toLowerCase();
        valB = (b.student_name ?? "").toLowerCase();
        break;
      case "uni":
        valA = (a.uni ?? "").toLowerCase();
        valB = (b.uni ?? "").toLowerCase();
        break;
      case "subject":
        valA = a.subject.toLowerCase();
        valB = b.subject.toLowerCase();
        break;
      case "assigned":
        valA = (assignedPersons[a.id] ?? "").toLowerCase();
        valB = (assignedPersons[b.id] ?? "").toLowerCase();
        break;
      case "confidence":
        valA = a.confidence;
        valB = b.confidence;
        break;
      case "received":
        valA = new Date(a.received_at.endsWith("Z") || a.received_at.includes("+") ? a.received_at : a.received_at + "Z").getTime();
        valB = new Date(b.received_at.endsWith("Z") || b.received_at.includes("+") ? b.received_at : b.received_at + "Z").getTime();
        break;
      case "sent":
        valA = a.approved_at ? new Date(a.approved_at.endsWith("Z") || a.approved_at.includes("+") ? a.approved_at : a.approved_at + "Z").getTime() : 0;
        valB = b.approved_at ? new Date(b.approved_at.endsWith("Z") || b.approved_at.includes("+") ? b.approved_at : b.approved_at + "Z").getTime() : 0;
        break;
      default:
        return 0;
    }

    if (valA < valB) return sortOrder === "asc" ? -1 : 1;
    if (valA > valB) return sortOrder === "asc" ? 1 : -1;
    return 0;
  });

  if (emails.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No approved emails.
      </div>
    );
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
            <th className={thClass} onClick={() => handleSort("assigned")}>
              Assigned <SortIcon field="assigned" sortField={sortField} sortOrder={sortOrder} />
            </th>
            <th className={thClass} onClick={() => handleSort("confidence")}>
              Confidence <SortIcon field="confidence" sortField={sortField} sortOrder={sortOrder} />
            </th>
            <th className={thClass} onClick={() => handleSort("received")}>
              Received <SortIcon field="received" sortField={sortField} sortOrder={sortOrder} />
            </th>
            {mode === "sent" && (
              <th className={thClass} onClick={() => handleSort("sent")}>
                Sent <SortIcon field="sent" sortField={sortField} sortOrder={sortOrder} />
              </th>
            )}
            <th className="px-4 py-2 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sortedEmails.map((email) => {
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
                    {savedDrafts[email.id] && <DraftBadge />}
                  </div>
                </td>

                <td className="px-4 py-2 whitespace-nowrap">
                  {email.uni ?? "—"}
                </td>

                <td className="px-4 py-2 min-w-0">
                  <span className="block truncate" title={email.subject}>
                    {email.subject}
                  </span>
                </td>

                <td className="px-4 py-2 w-35">
                  <select
                    value={assignedPersons[email.id] ?? ""}
                    onChange={(e) => onAssignPerson?.(email.id, e.target.value)}
                    className="w-full text-xs rounded border border-border bg-background px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Unassigned</option>
                    {ADVISORS.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </td>

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

                <td className="px-4 py-2">
                  {formatEastern(email.received_at)}
                </td>
                {mode === "sent" && (
                  <td className="px-4 py-2">
                    {email.approved_at ? formatEastern(email.approved_at) : "—"}
                  </td>
                )}
                <td className="px-4 py-2 space-x-2 w-60 whitespace-nowrap">
                  <button
                    onClick={() => onSelect(email)}
                    className="px-3 py-1 rounded-md text-xs font-medium bg-muted text-foreground hover:bg-muted/70"
                  >
                    View
                  </button>
                  {onSend && (
                    <button
                      onClick={() => onSend(email.id)}
                      disabled={sending}
                      className={`px-3 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1 ${
                        sending
                          ? "bg-green-600/50 text-white cursor-not-allowed"
                          : "bg-green-600 text-white hover:bg-green-700"
                      }`}
                      title={sending ? "Sending..." : "Send reply via Gmail"}
                    >
                      <Send className="h-3 w-3" />
                      {sending ? "Sending..." : "Send"}
                    </button>
                  )}
                  <button
                    onClick={() => onDelete(email.id)}
                    className="px-3 py-1 rounded-md text-xs font-medium bg-red-600 text-white hover:bg-red-700"
                  >
                    Delete
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
