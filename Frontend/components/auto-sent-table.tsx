"use client";

import { Email } from "./emails-tab";
import { CheckSquare, Square, CheckCircle, Clock, Send } from "lucide-react";
import DraftBadge from "./draft-badge";
import { ADVISORS } from "@/lib/constants";

type AutoSentTableProps = {
  emails?: Email[];
  searchTerm?: string;
  onDelete: (id: number) => void;
  onSelect: (email: Email) => void;
  onSend?: (id: number) => void;
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
  gmailConnected?: boolean;
  sending?: boolean;
  savedDrafts?: Record<number, string>;
  mode?: "pending" | "sent";
  assignedPersons?: Record<number, string>;
  onAssignPerson?: (emailId: number, person: string) => void;
};

function formatEastern(timestamp?: string | null) {
  if (!timestamp) return "—";

  // If the string has no timezone info, assume it's UTC and append "Z"
  const iso =
    timestamp.endsWith("Z") || timestamp.includes("+")
      ? timestamp
      : timestamp + "Z";

  const date = new Date(iso);

  return (
    date.toLocaleString("en-US", {
      timeZone: "America/New_York",
      dateStyle: "short",
      timeStyle: "short",
    })
  );
}

type TimeInfo = {
  label: string;
  minutes: number;
  severity: "green" | "yellow" | "red";
};

function getWaitingTime(received_at: string): TimeInfo {
  if (!received_at) return { label: "—", minutes: 0, severity: "green" };

  const receiveIso =
    received_at.endsWith("Z") || received_at.includes("+")
      ? received_at
      : received_at + "Z";

  const received = new Date(receiveIso);
  const now = new Date();

  let diffMs = now.getTime() - received.getTime();
  if (diffMs < 0) diffMs = 0;

  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  let label: string;
  if (diffMinutes < 1) {
    label = "<1m";
  } else if (diffMinutes < 60) {
    label = `${diffMinutes}m`;
  } else if (diffHours < 24) {
    const mins = diffMinutes % 60;
    label = mins > 0 ? `${diffHours}h ${mins}m` : `${diffHours}h`;
  } else {
    const hours = diffHours % 24;
    label = hours > 0 ? `${diffDays}d ${hours}h` : `${diffDays}d`;
  }

  let severity: TimeInfo["severity"];
  if (diffHours <= 12) {
    severity = "green";
  } else if (diffHours <= 24) {
    severity = "yellow";
  } else {
    severity = "red";
  }

  return { label, minutes: diffMinutes, severity };
}

function getResponseTime(received_at: string, approved_at?: string | null): TimeInfo {
  if (!received_at || !approved_at)
    return { label: "—", minutes: 0, severity: "green" };

  const receiveIso =
    received_at.endsWith("Z") || received_at.includes("+")
      ? received_at
      : received_at + "Z";
  const approvedIso =
    approved_at.endsWith("Z") || approved_at.includes("+")
      ? approved_at
      : approved_at + "Z";

  const received = new Date(receiveIso);
  const approved = new Date(approvedIso);
  let diffMs = approved.getTime() - received.getTime();
  if (diffMs < 0) diffMs = 0;

  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  let label: string;
  if (diffMinutes < 1) {
    label = "<1m";
  } else if (diffMinutes < 60) {
    label = `${diffMinutes}m`;
  } else if (diffHours < 24) {
    const mins = diffMinutes % 60;
    label = mins > 0 ? `${diffHours}h ${mins}m` : `${diffHours}h`;
  } else {
    const hours = diffHours % 24;
    label = hours > 0 ? `${diffDays}d ${hours}h` : `${diffDays}d`;
  }

  let severity: TimeInfo["severity"];
  if (diffHours <= 12) {
    severity = "green";
  } else if (diffHours <= 24) {
    severity = "yellow";
  } else {
    severity = "red";
  }

  return { label, minutes: diffMinutes, severity };
}

export default function AutoSentTable({
  emails = [],
  onDelete,
  onSelect,
  onSend,
  selectedIds = new Set(),
  onToggleSelect,
  gmailConnected = true,
  sending = false,
  savedDrafts = {},
  mode = "pending",
  assignedPersons = {},
  onAssignPerson,
}: AutoSentTableProps) {
  if (emails.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No approved emails.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted">
          <tr>
            {onToggleSelect && (
              <th className="px-3 py-2 text-left w-[40px]">
                <span className="sr-only">Select</span>
              </th>
            )}
            <th className="px-4 py-2 text-left">Student</th>
            <th className="px-4 py-2 text-left w-[80px]">UNI</th>
            <th className="px-4 py-2 text-left">Subject</th>
            <th className="px-4 py-2 text-left">Assigned</th>
            <th className="px-4 py-2 text-left">Confidence</th>
            <th className="px-4 py-2 text-left">
              {mode === "sent" ? "Waited" : "Waiting"}
            </th>
            <th className="px-4 py-2 text-left">Received</th>
            {mode === "sent" && <th className="px-4 py-2 text-left">Sent</th>}
            <th className="px-4 py-2 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {emails.map((email) => {
            const isSelected = selectedIds.has(email.id);
            const waitingTime = getWaitingTime(email.received_at);
            const responseTime = getResponseTime(email.received_at, email.approved_at);
            const timingInfo =
              mode === "sent"
                ? responseTime
                : waitingTime;

            return (
              <tr
                key={email.id}
                className={`border-t border-border hover:bg-muted/40 ${
                  isSelected ? "bg-blue-50" : ""
                }`}
              >
                {onToggleSelect && (
                  <td className="px-3 py-2">
                    <button
                      onClick={() => onToggleSelect(email.id)}
                      className="p-1 rounded hover:bg-gray-200"
                      aria-label={isSelected ? "Deselect" : "Select"}
                    >
                      {isSelected ? (
                        <CheckSquare className="h-4 w-4 text-blue-600" />
                      ) : (
                        <Square className="h-4 w-4 text-gray-400" />
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

                {/* UNI column */}
                <td className="px-4 py-2 w-[80px] whitespace-nowrap">
                  {email.uni ?? "—"}
                </td>

                <td className="px-4 py-2 w-[260px] max-w-[260px]">
                  <span className="block truncate" title={email.subject}>
                    {email.subject}
                  </span>
                </td>

                {/* Assigned column */}
                <td className="px-4 py-2 w-[140px]">
                  <select
                    value={assignedPersons[email.id] ?? ""}
                    onChange={(e) => onAssignPerson?.(email.id, e.target.value)}
                    className="w-full text-xs rounded border border-border bg-background px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">— Unassigned —</option>
                    {ADVISORS.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </td>

                <td className="px-4 py-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      email.confidence >= 0.8
                        ? "bg-green-100 text-green-800"
                        : email.confidence >= 0.6
                        ? "bg-yellow-100 text-yellow-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {(email.confidence * 100).toFixed(0)}%
                  </span>
                </td>

                {/* Waiting/Response Time Column */}
                <td className="px-4 py-2">
                  {(mode === "sent" ? email.approved_at : email.received_at) ? (
                    <div
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        timingInfo.severity === "green"
                          ? "bg-green-100 text-green-800"
                          : timingInfo.severity === "yellow"
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      <Clock className="h-3 w-3" />
                      {timingInfo.label}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>

                <td className="px-4 py-2">
                  {formatEastern(email.received_at)}
                </td>
                {mode === "sent" && (
                  <td className="px-4 py-2">
                    {email.approved_at ? formatEastern(email.approved_at) : "—"}
                  </td>
                )}
                <td className="px-4 py-2 flex items-center gap-2">
                  <button
                    onClick={() => onSelect(email)}
                    className="px-3 py-1 rounded-md text-xs font-medium bg-gray-200 text-foreground hover:bg-gray-300"
                  >
                    View
                  </button>
                  {onSend && (
                    <button
                      onClick={() => onSend(email.id)}
                      disabled={sending || !gmailConnected}
                      className={`px-3 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1 ${
                        sending || !gmailConnected
                          ? "bg-green-600/50 text-white cursor-not-allowed"
                          : "bg-green-600 text-white hover:bg-green-700"
                      }`}
                      title={
                        gmailConnected
                          ? sending
                            ? "Sending..."
                            : "Send reply via Gmail"
                          : "Connect Gmail in Settings first"
                      }
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
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
