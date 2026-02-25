"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Clock, AlertTriangle, Send } from "lucide-react";
import { BACKEND_URL } from "@/lib/constants";

// must match SettingsTab
const CONFIDENCE_THRESHOLD_KEY = "confidenceThresholdPct";
const DEFAULT_CONFIDENCE_THRESHOLD_PCT = 90;

type Severity = "green" | "yellow" | "red" | "none";

function parseReceivedAt(received_at: string): Date {
  if (
    received_at.endsWith("Z") ||
    received_at.includes("+") ||
    received_at.includes("-", 10)
  ) {
    return new Date(received_at);
  }
  return new Date(received_at + "Z");
}

function formatDurationFromMinutes(minutes: number): string {
  if (minutes <= 0) return "<1m";
  const hours = Math.floor(minutes / 60);
  if (hours < 1) {
    return `${minutes}m`;
  }
  const days = Math.floor(hours / 24);
  if (hours < 24) {
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

function getSeverityFromMinutes(minutes: number): Severity {
  if (minutes <= 0) return "green";
  if (minutes <= 12 * 60) return "green";
  if (minutes <= 24 * 60) return "yellow";
  return "red";
}

function getWaitTimeColor(_severity: Severity) {
  return "text-foreground";
}

const getConfidenceColor = (_score: number) => {
  return "text-foreground";
};

type EmailStatus = "auto" | "review" | "sent";

type Email = {
  id: number;
  student_name?: string | null;
  subject: string;
  body: string;
  confidence: number; // 0–1
  status: EmailStatus;
  suggested_reply: string;
  received_at: string;
  approved_at?: string | null;
};

type ConfidenceBucket = {
  range: string;
  count: number;
  percentage: number;
};


export default function AnalyticsTab() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // threshold in PERCENT (50–100), same as SettingsTab slider
  const [thresholdPct, setThresholdPct] = useState<number>(
    DEFAULT_CONFIDENCE_THRESHOLD_PCT,
  );

  // --- Fetch all emails from backend ---
  useEffect(() => {
    async function fetchEmails() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`${BACKEND_URL}/emails`);
        if (!res.ok) {
          throw new Error("Failed to fetch emails");
        }
        const data: Email[] = await res.json();
        setEmails(data);
      } catch (err) {
        console.error(err);
        setError("Could not load analytics data");
      } finally {
        setLoading(false);
      }
    }

    fetchEmails();
  }, []);

  // --- Load advisor threshold from the same localStorage key as SettingsTab ---
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(CONFIDENCE_THRESHOLD_KEY);
    if (stored) {
      const value = Number(stored);
      if (!Number.isNaN(value)) {
        setThresholdPct(value);
      }
    }
  }, []);

  const total = emails.length;

  // --- Confidence distribution buckets (REAL, from DB) ---
  const bucketDefs = [
    { label: "0–60%", min: 0.0, max: 0.6 },
    { label: "60–80%", min: 0.6, max: 0.8 },
    { label: "80–95%", min: 0.8, max: 0.95 },
    { label: "95–100%", min: 0.95, max: 1.01 },
  ];

  const bucketCounts = new Array(bucketDefs.length).fill(0);
  for (const e of emails) {
    const c = e.confidence ?? 0;
    let idx = 0;
    if (c < 0.6) idx = 0;
    else if (c < 0.8) idx = 1;
    else if (c < 0.95) idx = 2;
    else idx = 3;
    bucketCounts[idx] += 1;
  }

  const confidenceDistribution: ConfidenceBucket[] = bucketDefs.map((b, i) => {
    const count = bucketCounts[i];
    const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
    return {
      range: b.label,
      count,
      percentage,
    };
  });

  // gradient-style colors for confidence buckets
  const getBucketColor = (range: string) => {
    if (range.startsWith("0")) {
      // 0–60%
      return "#fca5a5"; // soft red
    }
    if (range.startsWith("60")) {
      // 60–80%
      return "#fde68a"; // soft yellow
    }
    if (range.startsWith("80")) {
      // 80–95%
      return "#4ade80"; // light green
    }
    // 95–100%
    return "#22c55e"; // richer green
  };

  // --- Review breakdown (REAL: review emails by confidence bucket) ---
  const reviewEmails = emails.filter((e) => e.status === "review");
  const reviewTotal = reviewEmails.length;
  const sentEmails = emails.filter((e) => e.status === "sent");

  // --- Key insight numbers (use threshold from Settings) ---
  const effectiveThreshold = thresholdPct / 100; // convert 90 -> 0.90
  const thresholdPercent = thresholdPct;

  const lowConfAll = emails.filter(
    (e) => (e.confidence ?? 0) < effectiveThreshold,
  ).length;
  const lowConfPercent = total > 0 ? Math.round((lowConfAll / total) * 100) : 0;

  const pendingCount = reviewTotal;
  const sentCount = sentEmails.length;
  const pendingPercent =
    total > 0 ? Math.round((pendingCount / total) * 100) : 0;
  const pendingSendEmails = emails.filter((e) => e.status === "auto");
  const pendingSendPercent =
    total > 0 ? Math.round((pendingSendEmails.length / total) * 100) : 0;
  const sentPercent =
    total > 0 ? Math.round((sentCount / total) * 100) : 0;

  const avgPendingWait = (() => {
    if (reviewEmails.length === 0) {
      return { label: "—", minutes: 0, severity: "none" as Severity };
    }
    const now = new Date();
    let totalMinutes = 0;
    let count = 0;

    for (const email of reviewEmails) {
      const received = parseReceivedAt(email.received_at);
      if (!received) continue;
      const diffMinutes = Math.max(
        0,
        Math.floor((now.getTime() - received.getTime()) / 60000),
      );
      totalMinutes += diffMinutes;
      count++;
    }

    if (count === 0) {
      return { label: "—", minutes: 0, severity: "none" as Severity };
    }

    const avgMinutes = Math.round(totalMinutes / count);
    return {
      label: formatDurationFromMinutes(avgMinutes),
      minutes: avgMinutes,
      severity: getSeverityFromMinutes(avgMinutes),
    };
  })();

  const avgResponseTime = (() => {
    const completed = sentEmails.filter((email) => email.approved_at);
    if (completed.length === 0) {
      return { label: "—", minutes: 0, severity: "none" as Severity };
    }

    let totalMinutes = 0;
    let count = 0;

    for (const email of completed) {
      const received = parseReceivedAt(email.received_at);
      const approved = parseReceivedAt(email.approved_at!);
      if (!received || !approved) continue;
      const diffMinutes = Math.max(
        0,
        Math.floor((approved.getTime() - received.getTime()) / 60000),
      );
      totalMinutes += diffMinutes;
      count++;
    }

    if (count === 0) {
      return { label: "—", minutes: 0, severity: "none" as Severity };
    }

    const avgMinutes = Math.round(totalMinutes / count);
    return {
      label: formatDurationFromMinutes(avgMinutes),
      minutes: avgMinutes,
      severity: getSeverityFromMinutes(avgMinutes),
    };
  })();

  const avgConfidenceAll =
    total > 0
      ? emails.reduce((sum, e) => sum + (e.confidence ?? 0), 0) / total
      : 0;
  const avgSentConfidence =
    sentEmails.length > 0
      ? sentEmails.reduce((sum, e) => sum + (e.confidence ?? 0), 0) /
        sentEmails.length
      : null;

  if (loading && !emails.length && !error) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-foreground">Analytics</h2>
        <p className="mt-1 text-muted-foreground">Loading analytics…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-foreground">Analytics</h2>
        <p className="mt-1 text-red-600">{error}</p>
      </div>
    );
  }

  if (!total) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-foreground">Analytics</h2>
        <p className="mt-1 text-muted-foreground">
          No emails yet — analytics will appear once emails start flowing into the system.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-foreground">Analytics</h2>
        <p className="mt-1 text-muted-foreground">
          Insights and metrics about your email review process
        </p>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Confidence Distribution */}
        <Card className="h-full">
          <CardHeader>
            <CardTitle className="text-lg">Confidence Distribution</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              How many emails fall into each confidence bracket
            </p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={360}>
              <BarChart data={confidenceDistribution}>
                <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
                <XAxis dataKey="range" stroke="#6b7280" />
                <YAxis stroke="#6b7280" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#f3f4f6",
                    border: "1px solid #d1d5db",
                  }}
                  formatter={(value, name) =>
                    name === "count"
                      ? [`${value} emails`, "Count"]
                      : [value, name]
                  }
                />
                <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                  {confidenceDistribution.map((item) => (
                    <Cell
                      key={item.range}
                      fill={getBucketColor(item.range)}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Operational Metrics */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card className="border shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <Clock className="h-4 w-4" />
                Avg Pending Wait
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-semibold flex items-center gap-2 ${avgPendingWait.severity !== "none" ? getWaitTimeColor(avgPendingWait.severity) : "text-muted-foreground"}`}>
                {avgPendingWait.severity === "red" && (
                  <AlertTriangle className="h-5 w-5" />
                )}
                {avgPendingWait.label}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {reviewEmails.length === 0
                  ? "No emails pending"
                  : "Average time pending emails currently wait in review"}
              </p>
            </CardContent>
          </Card>

          <Card className="border shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <Send className="h-4 w-4" />
                Avg Response Time
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-semibold flex items-center gap-2 ${avgResponseTime.severity !== "none" ? getWaitTimeColor(avgResponseTime.severity) : "text-muted-foreground"}`}>
                {avgResponseTime.severity === "red" && (
                  <AlertTriangle className="h-5 w-5" />
                )}
                {avgResponseTime.label}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {sentEmails.length === 0
                  ? "No replies sent yet"
                  : "Average time to approve + send"}
              </p>
            </CardContent>
          </Card>

          <Card className="border shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Avg Confidence (All)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-semibold ${getConfidenceColor(avgConfidenceAll)}`}>
                {(avgConfidenceAll * 100).toFixed(0)}%
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Confidence across all emails
              </p>
            </CardContent>
          </Card>

          <Card className="border shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Avg Confidence (Sent)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-semibold ${
                  avgSentConfidence !== null
                    ? getConfidenceColor(avgSentConfidence)
                    : "text-muted-foreground"
                }`}
              >
                {avgSentConfidence !== null
                  ? `${(avgSentConfidence * 100).toFixed(0)}%`
                  : "—"}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Confidence across sent emails
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Insights */}
      <Card className="border-blue-200 bg-blue-50">
        <CardHeader>
          <CardTitle className="text-lg text-blue-900">Key Insights</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-4">
            <div className="text-3xl font-bold text-blue-600">
              {pendingPercent}%
            </div>
            <p className="text-sm text-blue-800">
              of emails are pending review ({pendingCount} out of {total}).
              These emails are below the confidence threshold, so they need manual review.
            </p>
          </div>
          <div className="flex gap-4">
            <div className="text-3xl font-bold text-blue-600">
              {pendingSendPercent}%
            </div>
            <p className="text-sm text-blue-800">
              of emails are pending send ({pendingSendEmails.length} out of {total}).
              These emails are above the confidence threshold but auto-send wasn’t enabled.
            </p>
          </div>
          <div className="flex gap-4">
            <div className="text-3xl font-bold text-blue-600">
              {sentPercent}%
            </div>
            <p className="text-sm text-blue-800">
              of emails have been sent ({sentCount} out of {total}).
              These emails were either auto-sent or manually reviewed and approved for sending.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
      <p className="text-xs text-muted-foreground">
        Adjust the confidence threshold from the Settings tab to tune these insights.
      </p>
    </div>
  );
}