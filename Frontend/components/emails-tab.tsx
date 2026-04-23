"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import ManualReviewTable from "@/components/manual-review-table";
import AutoSentTable from "@/components/auto-sent-table";
import AssignedTable from "@/components/assigned-table";
import { SAMPLE_EMAILS } from "@/components/sample-emails";
import { CheckSquare, Square, Trash2, Send, Save, X, RotateCcw, Clock, AlertTriangle, RefreshCw, Mail, CheckCircle, Eye, EyeOff } from "lucide-react";
import { ADVISORS, BACKEND_URL } from "@/lib/constants";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

// Filter types
type FilterType = 
  | "all" 
  | "today"           // Received Today
  | "yesterday"       // Received Yesterday  
  | "thisWeek"        // Received This Week
  | "thisMonth"       // Received This Month
  | "thisYear";       // Received This Year

type EmailStatus = "auto" | "review" | "sent" | "personal" | "trash";

export type Email = {
  id: number;
  student_name?: string | null;
  uni?: string | null;
  email_address?: string | null;
  subject: string;
  body: string;
  confidence: number; // 0–1
  status: EmailStatus;
  suggested_reply: string;
  references?: { title: string; url: string | null }[];
  received_at: string; // ISO timestamp from backend
  approved_at?: string | null; // ISO timestamp when approved/sent
  assigned_to?: string | null;
};

type Metrics = {
  emails_total: number;
  emails_today: number;
  auto_count: number;
  review_count: number;
  sent_count?: number;
};

type SyncResult = {
  ingested: number;
  auto_sent: number;
  last_synced_at: string | null;
};

const DRAFTS_STORAGE_KEY = "emailDrafts";
const AUTO_SYNC_INTERVAL = 60000; // 60 seconds

// ============================================
// Date parsing helper - must be defined first
// ============================================

/**
 * Parse received_at timestamp - backend returns UTC timestamps WITHOUT the Z suffix
 * e.g., "2025-12-09T20:52:35.589000" is actually UTC, not local time
 * We need to append 'Z' to tell JavaScript it's UTC
 */
function parseReceivedAt(received_at: string): Date {
  // If already has timezone info, parse as-is
  if (received_at.endsWith('Z') || received_at.includes('+') || received_at.includes('-', 10)) {
    return new Date(received_at);
  }
  // Otherwise, assume UTC and append Z
  return new Date(received_at + 'Z');
}

// Helper to calculate waiting time
type WaitingTimeInfo = {
  label: string;
  minutes: number;
  hours: number;
  urgency: "low" | "medium" | "high" | "critical";
};

function getWaitingTime(received_at: string): WaitingTimeInfo {
  if (!received_at) return { label: "—", minutes: 0, hours: 0, urgency: "low" };

  // Use parseReceivedAt to handle timestamps without Z suffix
  const received = parseReceivedAt(received_at);
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

  // Determine urgency level: yellow after 2 days, red after 5 days
  let urgency: "low" | "medium" | "high" | "critical";
  if (diffDays < 2) {
    urgency = "low";
  } else if (diffDays < 5) {
    urgency = "medium";
  } else {
    urgency = "critical";
  }

  return { label, minutes: diffMinutes, hours: diffHours, urgency };
}

// ============================================
// FIXED: Date comparison helpers - comparing CALENDAR DAYS in LOCAL timezone
// ============================================

/**
 * Check if a received_at timestamp was received on today's calendar date (LOCAL time)
 */
function isReceivedToday(received_at: string): boolean {
  const emailDate = parseReceivedAt(received_at);
  const now = new Date();
  
  // Compare year, month, day in local timezone
  return (
    emailDate.getFullYear() === now.getFullYear() &&
    emailDate.getMonth() === now.getMonth() &&
    emailDate.getDate() === now.getDate()
  );
}

/**
 * Check if a received_at timestamp was received on yesterday's calendar date (LOCAL time)
 */
function isReceivedYesterday(received_at: string): boolean {
  const emailDate = parseReceivedAt(received_at);
  const now = new Date();
  
  // Get yesterday's date
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  
  // Compare year, month, day in local timezone
  return (
    emailDate.getFullYear() === yesterday.getFullYear() &&
    emailDate.getMonth() === yesterday.getMonth() &&
    emailDate.getDate() === yesterday.getDate()
  );
}

/**
 * Check if a date string is within the last N days
 */
function isWithinLastNDays(received_at: string, days: number): boolean {
  const received = parseReceivedAt(received_at);
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return received >= cutoff;
}

/**
 * Check if a timestamp is within the current calendar month (LOCAL time)
 */
function isReceivedThisMonth(received_at: string): boolean {
  const emailDate = parseReceivedAt(received_at);
  const now = new Date();
  return (
    emailDate.getFullYear() === now.getFullYear() &&
    emailDate.getMonth() === now.getMonth()
  );
}

/**
 * Check if a timestamp is within the current calendar year (LOCAL time)
 */
function isReceivedThisYear(received_at: string): boolean {
  const emailDate = parseReceivedAt(received_at);
  const now = new Date();
  return emailDate.getFullYear() === now.getFullYear();
}

export default function EmailsTab() {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [activeSection, setActiveSection] = useState<"review" | "pending" | "sent" | "personal" | "trash" | "forwarded">("review");

  const [emails, setEmails] = useState<Email[]>([]);
  const [reviewEmails, setReviewEmails] = useState<Email[]>([]);
  const [pendingEmails, setPendingEmails] = useState<Email[]>([]);
  const [sentEmails, setSentEmails] = useState<Email[]>([]);
  const [personalEmails, setPersonalEmails] = useState<Email[]>([]);
  const [trashEmails, setTrashEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [sending, setSending] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // detail panel
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [replyDraft, setReplyDraft] = useState<string>("");
  const [draftSaved, setDraftSaved] = useState<boolean>(false);
  const [panelWidth, setPanelWidth] = useState(560);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startWidth: panelWidth };
    const onMove = (ev: MouseEvent) => {
      if (!dragState.current) return;
      const delta = dragState.current.startX - ev.clientX;
      const next = Math.min(Math.max(dragState.current.startWidth + delta, 400), window.innerWidth * 0.9);
      setPanelWidth(next);
    };
    const onUp = () => {
      dragState.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [panelWidth]);

  // metrics from backend - we'll calculate emails_today ourselves
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  // Gmail connection status
  const [gmailConnected, setGmailConnected] = useState<boolean>(false);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState<boolean>(false);

  // Saved drafts (localStorage)
  const [savedDrafts, setSavedDrafts] = useState<Record<number, string>>({});

  // Assigned persons (localStorage)
  const [assignedPersons, setAssignedPersons] = useState<Record<number, string>>({});

  // Forward confirmation dialog
  const [forwardPending, setForwardPending] = useState<{ emailId: number; person: string } | null>(null);

  // Advisor toggle filter (single-select; null = show all)
  const [advisorFilter, setAdvisorFilter] = useState<string | null>(null);

  // Preview toggle
  const [showPreview, setShowPreview] = useState(false);

  // Updated filters
  const filters: { id: FilterType; label: string; description: string }[] = [
    { id: "all", label: "All", description: "Show all emails" },
    { id: "today", label: "Today", description: "Emails received today" },
    { id: "yesterday", label: "Yesterday", description: "Emails received yesterday" },
    { id: "thisWeek", label: "This Week", description: "Emails received in the last 7 days" },
    { id: "thisMonth", label: "This Month", description: "Emails received during the current month" },
    { id: "thisYear", label: "This Year", description: "Emails received during the current year" },
  ];

  // Show toast notification
  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // --- Load saved drafts from localStorage ---
  useEffect(() => {
    if (typeof window === "undefined") return;

    const stored = window.localStorage.getItem(DRAFTS_STORAGE_KEY);
    if (stored) {
      try {
        setSavedDrafts(JSON.parse(stored));
      } catch {
        // ignore parse errors
      }
    }
  }, []);

  // --- Save drafts to localStorage whenever they change ---
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(savedDrafts));
  }, [savedDrafts]);

  // --- Assign a person to an email (persisted to backend) ---
  async function doAssign(emailId: number, person: string) {
    setAssignedPersons((prev) => ({ ...prev, [emailId]: person }));
    try {
      const res = await fetch(`${BACKEND_URL}/emails/${emailId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigned_to: person || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.detail || "Failed to save assignment", "error");
      }
    } catch (err) {
      console.error("Failed to save advisor assignment:", err);
      showToast("Failed to save assignment", "error");
    }
  }

  function handleAssignPerson(emailId: number, person: string) {
    if (person) {
      setForwardPending({ emailId, person });
    } else {
      doAssign(emailId, "");
    }
  }

  async function handleForwardConfirm() {
    if (!forwardPending) return;
    const { emailId, person } = forwardPending;
    setForwardPending(null);
    await doAssign(emailId, person);
    try {
      const res = await fetch(`${BACKEND_URL}/emails/${emailId}/forward`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.detail || "Forward failed — is Gmail connected?", "error");
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.message || "Email forwarded", "success");
      }
    } catch (err) {
      console.error("Failed to forward email:", err);
      showToast("Assignment saved, but forward failed", "error");
    }
  }

  function handleForwardDecline() {
    if (!forwardPending) return;
    const { emailId, person } = forwardPending;
    setForwardPending(null);
    doAssign(emailId, person);
  }

  // --- Toggle an advisor filter pill on/off (single-select) ---
  function toggleAdvisorFilter(key: string) {
    setAdvisorFilter((prev) => (prev === key ? null : key));
  }

  // --- Fetch Gmail status ---
  async function fetchGmailStatus() {
    try {
      const res = await fetch(`${BACKEND_URL}/gmail/status`);
      if (res.ok) {
        const data = await res.json();
        setGmailConnected(data.connected);
        if (data.last_synced_at) {
          setLastSyncedAt(data.last_synced_at);
        }
      }
    } catch (err) {
      console.error("Failed to fetch Gmail status:", err);
    }
  }

  // --- Fetch emails from backend ---
  async function fetchEmails() {
    try {
      setLoading(true);
      setError(null);

      const [res, trashRes] = await Promise.all([
        fetch(`${BACKEND_URL}/emails`),
        fetch(`${BACKEND_URL}/emails?status=trash`),
      ]);
      if (!res.ok) throw new Error("Failed to fetch emails from backend");

      const allEmails: Email[] = await res.json();
      const trashed: Email[] = trashRes.ok ? await trashRes.json() : [];

      setEmails(allEmails);
      setTrashEmails(trashed);

      // Seed assignedPersons from backend data
      const fromBackend: Record<number, string> = {};
      for (const e of allEmails) {
        if (e.assigned_to) fromBackend[e.id] = e.assigned_to;
      }
      setAssignedPersons(fromBackend);
    } catch (err) {
      console.error(err);
      setError("Could not load emails from backend");
    } finally {
      setLoading(false);
    }
  }

  // --- Fetch metrics from backend ---
  async function fetchMetrics() {
    try {
      const res = await fetch(`${BACKEND_URL}/metrics`);
      if (!res.ok) {
        throw new Error("Failed to fetch metrics");
      }
      const data: Metrics = await res.json();
      setMetrics(data);
    } catch (err) {
      console.error(err);
      // metrics failure is non-blocking
    }
  }

  // --- Sync emails from Gmail ---
  async function syncEmails() {
    if (!gmailConnected) {
      showToast("Gmail not connected. Please connect in Settings.", "error");
      return;
    }

    try {
      setSyncing(true);
      setError(null);

      const res = await fetch(`${BACKEND_URL}/gmail/fetch`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Failed to sync emails");
      }

      const data: SyncResult = await res.json();
      setLastSyncedAt(data.last_synced_at ?? new Date().toISOString());

      await Promise.all([fetchEmails(), fetchMetrics()]);

      if (data.ingested > 0) {
        showToast(`Synced ${data.ingested} new email(s) from Gmail`, "success");
      } else {
        showToast("No new emails to sync", "success");
      }
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "Could not sync emails", "error");
    } finally {
      setSyncing(false);
    }
  }

  // --- Seed ONE random example email into backend ---
  async function seedExampleEmails() {
    try {
      setSeeding(true);
      setError(null);

      const random =
        SAMPLE_EMAILS[Math.floor(Math.random() * SAMPLE_EMAILS.length)];

      const sampleEmail = {
        student_name: random.student_name,
        uni: random.uni,
        email_address: random.email,
        subject: random.subject,
        body: random.body,
        received_at: new Date().toISOString(),
      };

      const ingestRes = await fetch(`${BACKEND_URL}/emails/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sampleEmail),
      });
      if (!ingestRes.ok) {
        const data = await ingestRes.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to create sample email");
      }

      await Promise.all([fetchEmails(), fetchMetrics()]);
      showToast("Sample email created", "success");
    } catch (err) {
      console.error(err);
      setError("Could not create sample email");
    } finally {
      setSeeding(false);
    }
  }

  // --- Advisor actions: approve and send reply via Gmail ---
  async function handleApproveAndSend(emailId: number, newReply?: string) {
    try {
      setSending(true);

      // First update the reply if changed
      if (newReply !== undefined) {
        const patchRes = await fetch(`${BACKEND_URL}/emails/${emailId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ suggested_reply: newReply }),
        });
        if (!patchRes.ok) {
          const data = await patchRes.json().catch(() => ({}));
          throw new Error(data.detail || "Failed to save reply edits");
        }
      }

      // Then send the reply via Gmail
      const res = await fetch(`${BACKEND_URL}/emails/${emailId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply_text: newReply ?? undefined }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Failed to send reply");
      }

      const data = await res.json();
      showToast(data.message || "Reply sent successfully!", "success");

      // Remove from saved drafts after sending
      setSavedDrafts((prev) => {
        const updated = { ...prev };
        delete updated[emailId];
        return updated;
      });

      await Promise.all([fetchEmails(), fetchMetrics()]);
    } catch (err: any) {
      showToast(err.message || "Could not send reply", "error");
    } finally {
      setSending(false);
    }
  }

  // --- Advisor actions: approve only (change status to auto without sending) ---
  async function handleApproveOnly(emailId: number, newReply?: string) {
    try {
      const body: any = { status: "auto" };
      if (newReply !== undefined) {
        body.suggested_reply = newReply;
      }

      const approveRes = await fetch(`${BACKEND_URL}/emails/${emailId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!approveRes.ok) {
        const data = await approveRes.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to approve email");
      }

      // Remove from saved drafts after approval
      setSavedDrafts((prev) => {
        const updated = { ...prev };
        delete updated[emailId];
        return updated;
      });

      await Promise.all([fetchEmails(), fetchMetrics()]);
      showToast("Email approved", "success");
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "Could not update email status", "error");
    }
  }

  // --- Advisor actions: move email to trash (soft delete) ---
  async function handleDelete(emailId: number) {
    try {
      const res = await fetch(`${BACKEND_URL}/emails/${emailId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "trash" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to move email to trash");
      }

      setSavedDrafts((prev) => { const u = { ...prev }; delete u[emailId]; return u; });
      setSelectedIds((prev) => { const u = new Set(prev); u.delete(emailId); return u; });

      await Promise.all([fetchEmails(), fetchMetrics()]);
      showToast("Email moved to Trash", "success");
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "Could not delete email", "error");
    }
  }

  // --- Restore email from trash ---
  async function handleRestore(emailId: number) {
    try {
      const res = await fetch(`${BACKEND_URL}/emails/${emailId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "review" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to restore email");
      }
      await Promise.all([fetchEmails(), fetchMetrics()]);
      showToast("Email restored to Needs Review", "success");
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "Could not restore email", "error");
    }
  }

  // --- Permanently delete email (from trash only) ---
  async function handlePermanentDelete(emailId: number) {
    try {
      const res = await fetch(`${BACKEND_URL}/emails/${emailId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to permanently delete email");
      }
      setSavedDrafts((prev) => { const u = { ...prev }; delete u[emailId]; return u; });
      setSelectedIds((prev) => { const u = new Set(prev); u.delete(emailId); return u; });
      await Promise.all([fetchEmails(), fetchMetrics()]);
      showToast("Email permanently deleted", "success");
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "Could not permanently delete email", "error");
    }
  }

  // --- Save draft without sending ---
  function handleSaveDraft(emailId: number, draft: string) {
    setSavedDrafts((prev) => ({
      ...prev,
      [emailId]: draft,
    }));
    setDraftSaved(true);
    setTimeout(() => setDraftSaved(false), 2000);
  }

  // --- Bulk approve and send selected emails ---
  async function handleBulkApproveAndSend() {
    if (selectedIds.size === 0) return;

    if (!gmailConnected) {
      showToast("Gmail not connected. Please connect in Settings.", "error");
      return;
    }

    setBulkActionLoading(true);
    try {
      const promises = Array.from(selectedIds).map((id) => {
        const draft = savedDrafts[id];
        return handleApproveAndSend(id, draft);
      });
      await Promise.all(promises);
      setSelectedIds(new Set());
    } catch (err) {
      console.error(err);
      setError("Could not approve and send selected emails");
    } finally {
      setBulkActionLoading(false);
    }
  }

  // --- Bulk delete selected emails ---
  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete ${selectedIds.size} email(s)?`
    );
    if (!confirmed) return;

    setBulkActionLoading(true);
    try {
      const promises = Array.from(selectedIds).map((id) => handleDelete(id));
      await Promise.all(promises);
      setSelectedIds(new Set());
    } catch (err) {
      console.error(err);
      setError("Could not delete selected emails");
    } finally {
      setBulkActionLoading(false);
    }
  }

  // --- Bulk unassign selected emails ---
  async function handleBulkUnassign() {
    if (selectedIds.size === 0) return;
    setBulkActionLoading(true);
    try {
      await Promise.all(Array.from(selectedIds).map((id) => doAssign(id, "")));
      setSelectedIds(new Set());
    } catch (err) {
      console.error(err);
      showToast("Could not unassign selected emails", "error");
    } finally {
      setBulkActionLoading(false);
    }
  }

  // --- Toggle selection for an email ---
  function toggleSelect(emailId: number) {
    setSelectedIds((prev) => {
      const updated = new Set(prev);
      if (updated.has(emailId)) {
        updated.delete(emailId);
      } else {
        updated.add(emailId);
      }
      return updated;
    });
  }

  // --- Select all visible emails ---
  function selectAllVisible(emails: Email[]) {
    const allIds = emails.map((e) => e.id);
    setSelectedIds(new Set(allIds));
  }

  // --- Deselect all ---
  function deselectAll() {
    setSelectedIds(new Set());
  }

  // --- Selecting an email (for detail panel) ---
  function handleSelect(email: Email) {
    setSelectedEmail(email);
    // Load saved draft if exists, otherwise use suggested_reply
    const draft = savedDrafts[email.id] ?? email.suggested_reply ?? "";
    setReplyDraft(draft);
    setDraftSaved(false);
  }

  function closeDetail() {
    setSelectedEmail(null);
    setReplyDraft("");
    setDraftSaved(false);
  }

  // --- Reset reply to original AI suggestion ---
  function resetToOriginal() {
    if (selectedEmail) {
      setReplyDraft(selectedEmail.suggested_reply || "");
      // Remove saved draft
      setSavedDrafts((prev) => {
        const updated = { ...prev };
        delete updated[selectedEmail.id];
        return updated;
      });
    }
  }

  // --- Keyboard shortcuts ---
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!selectedEmail) return;

      // Don't trigger shortcuts when typing in textarea
      if (e.target instanceof HTMLTextAreaElement) return;

      if (e.key === "Escape") {
        closeDetail();
      }
    },
    [selectedEmail]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // --- Initial load ---
  useEffect(() => {
    fetchEmails();
    fetchMetrics();
    fetchGmailStatus();
  }, []);

  // --- Auto-sync polling (every 60 seconds if Gmail is connected) ---
  useEffect(() => {
    if (!gmailConnected) return;

    const interval = setInterval(() => {
      // Silent sync - don't show loading indicator for auto-sync
      fetch(`${BACKEND_URL}/gmail/fetch`)
        .then((res) => res.json())
        .then((data: SyncResult) => {
          if (data.ingested > 0) {
            fetchEmails();
            fetchMetrics();
            showToast(`${data.ingested} new email(s) received`, "success");
          }
          if (data.last_synced_at) {
            setLastSyncedAt(data.last_synced_at);
          }
        })
        .catch(console.error);
    }, AUTO_SYNC_INTERVAL);

    return () => clearInterval(interval);
  }, [gmailConnected, showToast]);

  // --- Categorize emails anytime backend list changes ---
  useEffect(() => {
    const nextReview: Email[] = [];
    const nextPending: Email[] = [];
    const nextSent: Email[] = [];
    const nextPersonal: Email[] = [];

    emails.forEach((email) => {
      if (email.status === "personal") {
        nextPersonal.push(email);
      } else if (email.status === "sent") {
        nextSent.push(email);
      } else if (email.status === "review") {
        nextReview.push(email);
      } else {
        nextPending.push(email);
      }
    });

    setReviewEmails(nextReview);
    setPendingEmails(nextPending);
    setSentEmails(nextSent);
    setPersonalEmails(nextPersonal);
  }, [emails]);

  // --- FIXED: Helper to apply filter + search to a list of emails ---
  function filterEmails(emails: Email[]): Email[] {
    let filtered = [...emails];

    // Apply time-based filters
    if (activeFilter === "today") {
      filtered = filtered.filter((e) => isReceivedToday(e.received_at));
    }

    if (activeFilter === "yesterday") {
      filtered = filtered.filter((e) => isReceivedYesterday(e.received_at));
    }

    if (activeFilter === "thisWeek") {
      filtered = filtered.filter((e) => isWithinLastNDays(e.received_at, 7));
    }

    if (activeFilter === "thisMonth") {
      filtered = filtered.filter((e) => isReceivedThisMonth(e.received_at));
    }

    if (activeFilter === "thisYear") {
      filtered = filtered.filter((e) => isReceivedThisYear(e.received_at));
    }

    // Text search: student name, UNI, subject
    if (searchTerm.trim().length > 0) {
      const q = searchTerm.toLowerCase();
      filtered = filtered.filter((e) => {
        return (
          (e.student_name ?? "").toLowerCase().includes(q) ||
          (e.uni ?? "").toLowerCase().includes(q) ||
          e.subject.toLowerCase().includes(q)
        );
      });
    }

    // Advisor filter: show only emails assigned to the selected advisor
    if (advisorFilter !== null) {
      filtered = filtered.filter((e) => {
        const assigned = assignedPersons[e.id] ?? "";
        return assigned === advisorFilter;
      });
    }

    return filtered;
  }

  const filteredReviewEmails = filterEmails(reviewEmails);
  const filteredPendingEmails = filterEmails(pendingEmails);
  const filteredSentEmails = filterEmails(sentEmails);
  const filteredPersonalEmails = filterEmails(personalEmails);
  const filteredTrashEmails = filterEmails(trashEmails);

  const forwardedEmails = emails.filter((e) => !!assignedPersons[e.id]);
  const filteredForwardedEmails = filterEmails(forwardedEmails);

  // Calculate the CORRECT emails today count from all emails
  const allEmails = emails;
  const correctEmailsTodayCount = allEmails.filter((e) => isReceivedToday(e.received_at)).length;

  // Count selected in current view
  const selectedInView =
    activeSection === "review"
      ? filteredReviewEmails.filter((e) => selectedIds.has(e.id)).length
      : activeSection === "pending"
      ? filteredPendingEmails.filter((e) => selectedIds.has(e.id)).length
      : activeSection === "personal"
      ? filteredPersonalEmails.filter((e) => selectedIds.has(e.id)).length
      : activeSection === "trash"
      ? filteredTrashEmails.filter((e) => selectedIds.has(e.id)).length
      : activeSection === "forwarded"
      ? filteredForwardedEmails.filter((e) => selectedIds.has(e.id)).length
      : filteredSentEmails.filter((e) => selectedIds.has(e.id)).length;

  const currentEmails =
    activeSection === "review"
      ? filteredReviewEmails
      : activeSection === "pending"
      ? filteredPendingEmails
      : activeSection === "personal"
      ? filteredPersonalEmails
      : activeSection === "trash"
      ? filteredTrashEmails
      : activeSection === "forwarded"
      ? filteredForwardedEmails
      : filteredSentEmails;

  const allVisibleSelected = currentEmails.length > 0 && currentEmails.every((e) => selectedIds.has(e.id));

  // Advisor filter pill row — rendered below each section's search bar
  const advisorFilterRow = (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground font-medium shrink-0">Advisor:</span>
      {[{ label: "Unassigned", key: "" }, ...ADVISORS.map((a) => ({ label: a, key: a }))].map(({ label, key }) => {
        const active = advisorFilter === key;
        return (
          <button
            key={key === "" ? "__unassigned__" : key}
            onClick={() => toggleAdvisorFilter(key)}
            className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
              active
                ? "bg-blue-600 text-white"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {label}
          </button>
        );
      })}
      {advisorFilter !== null && (
        <button
          onClick={() => setAdvisorFilter(null)}
          className="text-xs text-muted-foreground hover:text-foreground underline ml-1"
        >
          Clear
        </button>
      )}
    </div>
  );

  // Check if current email has unsaved changes
  const hasUnsavedChanges =
    selectedEmail && replyDraft !== (savedDrafts[selectedEmail.id] ?? selectedEmail.suggested_reply);

  // Determine derived status for selected email from backend state
  const isSelectedEmailPending = !!selectedEmail && selectedEmail.status === "auto";
  const isSelectedEmailNeedsReview = !!selectedEmail && selectedEmail.status === "review";
  const isSelectedEmailPersonal = !!selectedEmail && selectedEmail.status === "personal";
  const canEditSelectedEmail = !!selectedEmail && selectedEmail.status !== "sent";
  
  if (loading && !seeding && emails.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-foreground">Email Management</h2>
        <p className="text-muted-foreground mt-1">Loading emails…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-foreground">Email Management</h2>
        <p className="text-red-600 mt-1">{error}</p>
      </div>
    );
  }

  return (
    <>
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-[100] px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 ${
            toast.type === "success"
              ? "bg-green-600 text-white"
              : "bg-red-600 text-white"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle className="w-5 h-5" />
          ) : (
            <X className="w-5 h-5" />
          )}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 hover:opacity-80">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex flex-col h-full min-h-0">
        <div className="shrink-0 flex flex-col gap-3">
        {/* Header + Last synced */}
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-foreground">Email Management</h2>
          <span className="text-xs text-muted-foreground">
            Last synced:{" "}
            {lastSyncedAt
              ? new Date(lastSyncedAt).toLocaleString("en-US", {
                  timeZone: "America/New_York",
                  month: "2-digit",
                  day: "2-digit",
                  year: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: true,
                })
              : "Not yet"}
          </span>
        </div>

        {/* Action buttons + status */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={syncEmails}
            disabled={syncing || !gmailConnected}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium shadow-sm flex items-center gap-2 ${
              gmailConnected
                ? "bg-green-600 text-white hover:bg-green-700 disabled:opacity-60"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            }`}
            title={gmailConnected ? "Fetch new emails from Gmail" : "Connect Gmail in Settings first"}
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Sync from Gmail"}
          </button>

          <button
            onClick={seedExampleEmails}
            disabled={seeding}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white shadow-sm hover:bg-blue-700 disabled:opacity-60 flex items-center gap-2"
          >
            <Mail className="w-4 h-4" />
            {seeding ? "Creating..." : "Generate sample email"}
          </button>

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`inline-block w-2 h-2 rounded-full ${gmailConnected ? "bg-green-500" : "bg-muted-foreground"}`} />
            {gmailConnected ? "Gmail connected" : "Gmail not connected"}
          </div>
        </div>

        {/* Quick Filters + Preview toggle */}
        <div className="flex flex-wrap gap-1.5 items-center">
          {filters.map((filter) => (
            <button
              key={filter.id}
              onClick={() => setActiveFilter(filter.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeFilter === filter.id
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-muted text-foreground hover:bg-muted/70"
              }`}
              title={filter.description}
            >
              {filter.label}
            </button>
          ))}
          <div className="border-l border-border pl-2 ml-1">
            <button
              onClick={() => setShowPreview((p) => !p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                showPreview
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-muted text-foreground hover:bg-muted/70"
              }`}
              title={showPreview ? "Hide email preview" : "Show first lines of each email"}
            >
              {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              Preview
            </button>
          </div>
        </div>

        {/* Bulk Actions Bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <span className="text-sm font-medium text-blue-800">
              {selectedIds.size} email{selectedIds.size > 1 ? "s" : ""} selected
            </span>
            <div className="flex gap-2 ml-auto">
              {activeSection === "review" && (
                <button
                  onClick={handleBulkApproveAndSend}
                  disabled={bulkActionLoading || !gmailConnected}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-60"
                  title={gmailConnected ? "Approve and send all selected" : "Connect Gmail first"}
                >
                  <Send className="h-4 w-4" />
                  Send Replies
                </button>
              )}
              {activeSection === "pending" && (
                <button
                  onClick={handleBulkApproveAndSend}
                  disabled={bulkActionLoading || !gmailConnected}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-60"
                  title={gmailConnected ? "Send all selected" : "Connect Gmail first"}
                >
                  <Send className="h-4 w-4" />
                  Send All
                </button>
              )}
              {activeSection === "forwarded" && (
                <button
                  onClick={handleBulkUnassign}
                  disabled={bulkActionLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-60"
                >
                  Unassign All
                </button>
              )}
              <button
                onClick={handleBulkDelete}
                disabled={bulkActionLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" />
                Delete All
              </button>
              <button
                onClick={deselectAll}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-muted text-foreground hover:bg-muted/70"
              >
                <X className="h-4 w-4" />
                Clear Selection
              </button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-4 border-b border-border">
          <button
            onClick={() => setActiveSection("review")}
            className={`pb-3 px-1 font-medium text-sm transition-all ${
              activeSection === "review"
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Needs Review ({filteredReviewEmails.length})
          </button>
          <button
            onClick={() => setActiveSection("pending")}
            className={`pb-3 px-1 font-medium text-sm transition-all ${
              activeSection === "pending"
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Pending Send ({filteredPendingEmails.length})
          </button>
          <button
            onClick={() => setActiveSection("sent")}
            className={`pb-3 px-1 font-medium text-sm transition-all ${
              activeSection === "sent"
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Sent ({filteredSentEmails.length})
          </button>
          <button
            onClick={() => setActiveSection("forwarded")}
            className={`pb-3 px-1 font-medium text-sm transition-all ${
              activeSection === "forwarded"
                ? "text-purple-600 border-b-2 border-purple-600"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Assigned ({filteredForwardedEmails.length})
          </button>
          <button
            onClick={() => setActiveSection("personal")}
            className={`pb-3 px-1 font-medium text-sm transition-all ${
              activeSection === "personal"
                ? "text-red-600 border-b-2 border-red-600"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            ⚠ Personal ({filteredPersonalEmails.length})
          </button>
          <button
            onClick={() => setActiveSection("trash")}
            className={`pb-3 px-1 font-medium text-sm transition-all ${
              activeSection === "trash"
                ? "text-gray-600 border-b-2 border-gray-600"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="flex items-center gap-1">
              <Trash2 className="w-3.5 h-3.5" />
              Trash ({filteredTrashEmails.length})
            </span>
          </button>
        </div>
        </div>{/* end shrink-0 controls */}
        <div className="flex-1 min-h-0 flex flex-col pt-3 pb-4">
        {/* Tables + per-section search boxes */}
        {activeSection === "review" && (
          <div className="flex flex-col gap-3 h-full min-h-0">
            {/* Search bar + Select All for Needs Review */}
            <div className="shrink-0 flex items-center gap-3">
              <Input
                placeholder="Search by student name, UNI, or subject..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-md"
              />
              {filteredReviewEmails.length > 0 && (
                <button
                  onClick={() =>
                    allVisibleSelected ? deselectAll() : selectAllVisible(filteredReviewEmails)
                  }
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-muted text-foreground hover:bg-muted/70"
                >
                  {allVisibleSelected ? (
                    <CheckSquare className="h-4 w-4" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                  {allVisibleSelected ? "Deselect All" : "Select All"}
                </button>
              )}
            </div>
            <div className="shrink-0">{advisorFilterRow}</div>
            <div className="flex-1 min-h-0">
            <ManualReviewTable
              emails={filteredReviewEmails}
              searchTerm={searchTerm}
              onApprove={(id) => handleApproveAndSend(id)}
              onDelete={handleDelete}
              onSelect={handleSelect}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              savedDrafts={savedDrafts}
              assignedPersons={assignedPersons}
              onAssignPerson={handleAssignPerson}
              showPreview={showPreview}
            />
            </div>
          </div>
        )}

        {activeSection === "pending" && (
          <div className="flex flex-col gap-3 h-full min-h-0">
            {/* Search bar + Select All for Pending Send */}
            <div className="shrink-0 flex items-center gap-3">
              <Input
                placeholder="Search by student name, UNI, or subject..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-md"
              />
              {filteredPendingEmails.length > 0 && (
                <button
                  onClick={() =>
                    allVisibleSelected ? deselectAll() : selectAllVisible(filteredPendingEmails)
                  }
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-muted text-foreground hover:bg-muted/70"
                >
                  {allVisibleSelected ? (
                    <CheckSquare className="h-4 w-4" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                  {allVisibleSelected ? "Deselect All" : "Select All"}
                </button>
              )}
            </div>
            <div className="shrink-0">{advisorFilterRow}</div>
            <div className="flex-1 min-h-0">
            <AutoSentTable
              emails={filteredPendingEmails}
              searchTerm={searchTerm}
              onDelete={handleDelete}
              onSelect={handleSelect}
              onSend={handleApproveAndSend}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              sending={sending}
              savedDrafts={savedDrafts}
              mode="pending"
              assignedPersons={assignedPersons}
              onAssignPerson={handleAssignPerson}
              showPreview={showPreview}
            />
            </div>
          </div>
        )}

        {activeSection === "personal" && (
          <div className="flex flex-col gap-3 h-full min-h-0">
            <div className="shrink-0 rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                <p className="font-semibold text-red-700">Personal / Sensitive Emails</p>
              </div>
              <p className="text-sm text-red-600">
                These emails contain personal or sensitive topics and require direct advisor attention.
                They will never be auto-sent.
              </p>
            </div>
            <div className="shrink-0 flex items-center gap-3">
              <Input
                type="text"
                placeholder="Search personal emails..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-sm"
              />
            </div>
            <div className="shrink-0">{advisorFilterRow}</div>
            <div className="flex-1 min-h-0">
            <ManualReviewTable
              emails={filteredPersonalEmails}
              searchTerm={searchTerm}
              onApprove={(id) => handleApproveAndSend(id)}
              onDelete={handleDelete}
              onSelect={handleSelect}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              savedDrafts={savedDrafts}
              assignedPersons={assignedPersons}
              onAssignPerson={handleAssignPerson}
              showPreview={showPreview}
            />
            </div>
          </div>
        )}

        {activeSection === "trash" && (
          <div className="flex flex-col gap-3 h-full min-h-0">
            <div className="shrink-0 rounded-lg border border-gray-200 bg-gray-50 dark:bg-gray-900/20 dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-1">
                <Trash2 className="h-5 w-5 text-gray-500" />
                <p className="font-semibold text-gray-700 dark:text-gray-300">Trash</p>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Deleted emails are kept here. Restore them to move back to Needs Review, or permanently delete them.
              </p>
            </div>
            <div className="shrink-0 flex items-center gap-3">
              <Input
                type="text"
                placeholder="Search trash..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-sm"
              />
            </div>
            {filteredTrashEmails.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Trash is empty.</p>
            ) : (
              <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide">
                    <tr>
                      <th className="px-4 py-2 text-left">From</th>
                      <th className="px-4 py-2 text-left">Subject</th>
                      <th className="px-4 py-2 text-left">Received</th>
                      <th className="px-4 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredTrashEmails.map((email) => (
                      <tr key={email.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium">{email.student_name ?? "Unknown"}{email.uni ? ` (${email.uni})` : ""}</td>
                        <td className="px-4 py-3 text-muted-foreground truncate max-w-xs">{email.subject}</td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                          {new Date(email.received_at).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" })}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 justify-end">
                            <button
                              onClick={() => handleRestore(email.id)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Restore
                            </button>
                            <button
                              onClick={async () => {
                                if (window.confirm("Permanently delete this email? This cannot be undone.")) {
                                  await handlePermanentDelete(email.id);
                                }
                              }}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete forever
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeSection === "forwarded" && (
          <div className="flex flex-col gap-3 h-full min-h-0">
            <div className="shrink-0 flex items-center gap-3">
              <Input
                placeholder="Search by student name, UNI, or subject..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-md"
              />
              {filteredForwardedEmails.length > 0 && (
                <button
                  onClick={() =>
                    allVisibleSelected ? deselectAll() : selectAllVisible(filteredForwardedEmails)
                  }
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-muted text-foreground hover:bg-muted/70"
                >
                  {allVisibleSelected ? (
                    <CheckSquare className="h-4 w-4" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                  {allVisibleSelected ? "Deselect All" : "Select All"}
                </button>
              )}
            </div>
            <div className="shrink-0">{advisorFilterRow}</div>
            <div className="flex-1 min-h-0">
              <AssignedTable
                emails={filteredForwardedEmails}
                assignedPersons={assignedPersons}
                onUnassign={(id) => doAssign(id, "")}
                onSelect={handleSelect}
                savedDrafts={savedDrafts}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                showPreview={showPreview}
              />
            </div>
          </div>
        )}

        {activeSection === "sent" && (
          <div className="flex flex-col gap-3 h-full min-h-0">
            {/* Search bar + Select All for Sent */}
            <div className="shrink-0 flex items-center gap-3">
              <Input
                placeholder="Search by student name, UNI, or subject..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-md"
              />
              {filteredSentEmails.length > 0 && (
                <button
                  onClick={() =>
                    allVisibleSelected ? deselectAll() : selectAllVisible(filteredSentEmails)
                  }
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-muted text-foreground hover:bg-muted/70"
                >
                  {allVisibleSelected ? (
                    <CheckSquare className="h-4 w-4" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                  {allVisibleSelected ? "Deselect All" : "Select All"}
                </button>
              )}
            </div>
            <div className="shrink-0">{advisorFilterRow}</div>
            <div className="flex-1 min-h-0">
            <AutoSentTable
              emails={filteredSentEmails}
              searchTerm={searchTerm}
              onDelete={handleDelete}
              onSelect={handleSelect}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              savedDrafts={savedDrafts}
              mode="sent"
              assignedPersons={assignedPersons}
              onAssignPerson={handleAssignPerson}
              showPreview={showPreview}
            />
            </div>
          </div>
        )}
        </div>{/* end flex-1 table area */}
      </div>

      {/* Detail Panel */}
      {selectedEmail && (
        <div className="fixed inset-0 bg-black/40 flex justify-end z-50">
          <div className="relative bg-background h-full shadow-xl overflow-y-auto flex flex-col" style={{ width: panelWidth }}>
            {/* Drag handle */}
            <div
              onMouseDown={handleDragStart}
              className="absolute left-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400/50 transition-colors z-10"
              title="Drag to resize"
            />
            <div className="p-6 flex-1">
            <div className="flex items-start justify-between mb-4">
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">
                  {selectedEmail.subject}
                </h3>
                <p className="text-sm text-muted-foreground">
                  From: {selectedEmail.student_name ?? "Unknown student"}
                  {selectedEmail.uni && (
                    <>
                      {" · UNI: "}
                      {selectedEmail.uni}
                    </>
                  )}
                  {selectedEmail.email_address && (
                    <>
                      {" · "}
                      {selectedEmail.email_address}
                    </>
                  )}
                  {!selectedEmail.email_address && selectedEmail.uni && (
                    <>
                      {" · "}
                      {`${selectedEmail.uni}@columbia.edu`}
                    </>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  Received:{" "}
                  {new Date(selectedEmail.received_at).toLocaleString("en-US", {
                    timeZone: "America/New_York",
                    month: "2-digit",
                    day: "2-digit",
                    year: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true,
                  })}
                </p>
                
                {/* Status badges */}
                <div className="flex items-center gap-2 mt-1">
                  {selectedEmail.status === "sent" && (
                    <span className="inline-flex items-center gap-1 text-xs text-green-600 bg-green-100 px-2 py-1 rounded-full">
                      <CheckCircle className="w-3 h-3" />
                      Reply Sent
                    </span>
                  )}

                  {selectedEmail.status === "auto" && (
                    <span className="inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded-full">
                      <Clock className="w-3 h-3" />
                      Pending Send
                    </span>
                  )}
                  
                  {/* Waiting time indicator for review emails */}
                  {selectedEmail.status === "review" && (() => {
                    const waitTime = getWaitingTime(selectedEmail.received_at);
                    return (
                      <div
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                          waitTime.urgency === "low"
                            ? "bg-green-100 text-green-800"
                            : waitTime.urgency === "medium"
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {waitTime.urgency === "critical" ? (
                          <AlertTriangle className="h-3.5 w-3.5" />
                        ) : (
                          <Clock className="h-3.5 w-3.5" />
                        )}
                        Waiting: {waitTime.label}
                        {waitTime.urgency === "critical" && " — Urgent!"}
                      </div>
                    );
                  })()}
                </div>
              </div>
              <button
                onClick={closeDetail}
                className="text-sm text-muted-foreground hover:text-foreground p-1"
                aria-label="Close details"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Student email */}
            <div className="mb-4">
              <h4 className="text-sm font-semibold mb-1">Student email</h4>
              <div className="text-sm border border-border rounded-md p-3 bg-muted/40 whitespace-pre-wrap">
                {selectedEmail.body}
              </div>
            </div>

            {/* AI reply */}
            <div className="mb-2">
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-sm font-semibold">AI-suggested reply</h4>
                {canEditSelectedEmail && (
                  <button
                    onClick={resetToOriginal}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-muted text-foreground hover:bg-muted/70 border border-border transition-colors"
                    title="Reset to original AI suggestion"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset to Original
                  </button>
                )}
              </div>

              {canEditSelectedEmail ? (
                // Editable textarea for any unsent email
                <textarea
                  className="w-full border border-border rounded-md p-2 text-sm min-h-64 resize-vertical focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={replyDraft}
                  onChange={(e) => setReplyDraft(e.target.value)}
                />
              ) : (
                // Read-only for approved/sent emails
                <div className="text-sm border border-border rounded-md p-3 bg-muted/40 whitespace-pre-wrap min-h-64">
                  {selectedEmail.suggested_reply}
                </div>
              )}
            </div>

            {/* Confidence + Draft indicator */}
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-muted-foreground">
                Confidence: {(selectedEmail.confidence * 100).toFixed(0)}%
                {selectedEmail.email_address && (
                  <span className="ml-2">
                    · Will send to: <span className="font-medium">{selectedEmail.email_address}</span>
                  </span>
                )}
              </p>
              {savedDrafts[selectedEmail.id] && (
                <span className="text-xs text-amber-600 font-medium">
                  📝 Draft saved
                </span>
              )}
              {draftSaved && (
                <span className="text-xs text-green-600 font-medium animate-pulse">
                  ✓ Saved!
                </span>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              {/* Approve & Send button - only for emails below threshold */}
              {isSelectedEmailNeedsReview && (
                <button
                  onClick={async () => {
                    await handleApproveAndSend(selectedEmail.id, replyDraft);
                    closeDetail();
                  }}
                  disabled={sending || !gmailConnected}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-60"
                  title={gmailConnected ? "Approve and send reply via Gmail" : "Connect Gmail first"}
                >
                  <Send className="h-4 w-4" />
                  {sending ? "Sending..." : "Send"}
                </button>
              )}

              {/* Send button for pending send emails */}
              {isSelectedEmailPending && (
                <button
                  onClick={async () => {
                    await handleApproveAndSend(selectedEmail.id, replyDraft);
                    closeDetail();
                  }}
                  disabled={sending || !gmailConnected}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-60"
                  title={gmailConnected ? "Send reply via Gmail" : "Connect Gmail first"}
                >
                  <Send className="h-4 w-4" />
                  {sending ? "Sending..." : "Send"}
                </button>
              )}

              {/* Send button for personal emails */}
              {isSelectedEmailPersonal && (
                <button
                  onClick={async () => {
                    await handleApproveAndSend(selectedEmail.id, replyDraft);
                    closeDetail();
                  }}
                  disabled={sending || !gmailConnected}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-60"
                  title={gmailConnected ? "Send reply via Gmail" : "Connect Gmail first"}
                >
                  <Send className="h-4 w-4" />
                  {sending ? "Sending..." : "Send"}
                </button>
              )}

              {/* Save draft available for all unsent emails */}
              {selectedEmail.status !== "sent" && (
                <button
                  onClick={() => handleSaveDraft(selectedEmail.id, replyDraft)}
                  disabled={!hasUnsavedChanges}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save className="h-4 w-4" />
                  Save Draft
                </button>
              )}

              {/* Delete is always available (except for sent emails) */}
              {selectedEmail.status !== "sent" && (
                <button
                  onClick={async () => {
                    await handleDelete(selectedEmail.id);
                    closeDetail();
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              )}

              <button
                onClick={closeDetail}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-border text-foreground hover:bg-muted/40"
              >
                Close
              </button>
            </div>

            {/* Keyboard hint */}
            <p className="mt-4 text-xs text-muted-foreground">
              Press <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">Esc</kbd> to close
            </p>
            </div>{/* end p-6 */}
          </div>
        </div>
      )}
      {/* Forward confirmation dialog */}
      <Dialog open={!!forwardPending} onOpenChange={(open) => { if (!open) handleForwardDecline(); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Forward this email?</DialogTitle>
            <DialogDescription>
              {forwardPending?.person} will be assigned and a copy of this email will be forwarded to <strong>lj2574@columbia.edu</strong>.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={handleForwardDecline}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-border text-foreground hover:bg-muted/40"
            >
              No, just assign
            </button>
            <button
              onClick={handleForwardConfirm}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"
            >
              Yes, forward
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
