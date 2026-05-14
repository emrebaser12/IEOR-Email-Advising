"use client";

import { useState } from "react";
import { Send, Sparkles, CheckCircle2, AlertCircle, RotateCcw } from "lucide-react";
import { BACKEND_URL } from "@/lib/constants";

const DEMO_SCENARIOS = [
  {
    label: "Course Registration",
    student_name: "Alex Chen",
    uni: "ac4521",
    email_address: "ac4521@columbia.edu",
    subject: "Question about course registration",
    body: "Hi Academic Advising Team,\n\nI am trying to register for IEOR 4150 but the system says I need permission. What do I need to do to get approved?\n\nBest,\nAlex Chen",
  },
  {
    label: "Double Counting",
    student_name: "Jordan Lee",
    uni: "jl5892",
    email_address: "jl5892@columbia.edu",
    subject: "Double counting question",
    body: "Hi Academic Advising Team,\n\nCan I double count a course toward both my major requirements and my science requirement?\n\nBest,\nJordan Lee",
  },
  {
    label: "Study Abroad",
    student_name: "Mia Patel",
    uni: "mp3347",
    email_address: "mp3347@columbia.edu",
    subject: "Study abroad and graduation requirements",
    body: "Hi Academic Advising Team,\n\nI am planning to study abroad next spring. Will I still be able to meet my graduation requirements on time?\n\nBest,\nMia Patel",
  },
  {
    label: "Course Withdrawal",
    student_name: "Sam Rivera",
    uni: "sr6610",
    email_address: "sr6610@columbia.edu",
    subject: "Withdrawing from a course",
    body: "Hi Academic Advising Team,\n\nI need to withdraw from one of my courses this semester due to personal reasons. What is the process and will it affect my GPA?\n\nBest,\nSam Rivera",
  },
  {
    label: "Appointment Scheduling",
    student_name: "Taylor Kim",
    uni: "tk2289",
    email_address: "tk2289@columbia.edu",
    subject: "Scheduling an advising appointment",
    body: "Hi Academic Advising Team,\n\nI would like to schedule a meeting with my academic advisor to discuss my course plan for next semester. How do I book an appointment?\n\nBest,\nTaylor Kim",
  },
];

const EMPTY_FORM = {
  student_name: "",
  uni: "",
  email_address: "",
  subject: "",
  body: "",
};

type Status = "idle" | "sending" | "success" | "error";

export default function ExpoTab() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  function fillScenario(scenario: (typeof DEMO_SCENARIOS)[0]) {
    const { label: _label, ...fields } = scenario;
    setForm(fields);
    setStatus("idle");
  }

  function reset() {
    setForm(EMPTY_FORM);
    setStatus("idle");
    setErrorMsg("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.body.trim() || !form.subject.trim()) return;
    setStatus("sending");
    setErrorMsg("");
    try {
      const res = await fetch(`${BACKEND_URL}/emails/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          received_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      setStatus("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Sparkles className="h-7 w-7 text-blue-500" />
          <h1 className="text-3xl font-bold text-foreground">Senior Design Expo</h1>
        </div>
        <p className="text-muted-foreground mt-1">
          Compose an email as a student and watch the AI advising system process it in real time.
          The email will appear in the <span className="font-medium text-foreground">Email Management</span> tab.
        </p>
      </div>

      {/* Demo scenario quick-fill */}
      <div>
        <p className="text-sm font-semibold text-foreground mb-2">Quick-fill a demo scenario</p>
        <div className="flex flex-wrap gap-2">
          {DEMO_SCENARIOS.map((s) => (
            <button
              key={s.label}
              onClick={() => fillScenario(s)}
              className="px-3 py-1.5 rounded-full text-xs font-medium border border-border bg-muted hover:bg-muted/60 transition-colors"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Compose form */}
      <form onSubmit={handleSubmit} className="space-y-4 bg-card border border-border rounded-xl p-6 shadow-sm">
        <p className="text-sm font-semibold text-foreground mb-1">Compose Email</p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Student Name</label>
            <input
              type="text"
              placeholder="e.g. Alex Chen"
              value={form.student_name}
              onChange={(e) => setForm({ ...form, student_name: e.target.value })}
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">UNI</label>
            <input
              type="text"
              placeholder="e.g. ac4521"
              value={form.uni}
              onChange={(e) => setForm({ ...form, uni: e.target.value })}
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Email Address</label>
          <input
            type="email"
            placeholder="e.g. ac4521@columbia.edu"
            value={form.email_address}
            onChange={(e) => setForm({ ...form, email_address: e.target.value })}
            className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Subject <span className="text-red-500">*</span></label>
          <input
            type="text"
            placeholder="Email subject"
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            required
            className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Message <span className="text-red-500">*</span></label>
          <textarea
            placeholder="Write the student's email here..."
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            required
            rows={8}
            className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500 resize-vertical"
          />
        </div>

        {/* Status feedback */}
        {status === "success" && (
          <div className="flex items-center gap-2 text-green-600 text-sm font-medium bg-green-50 border border-green-200 rounded-lg px-4 py-3">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Email received by the system! Check the <span className="underline mx-1">Email Management</span> tab to see the AI response.
          </div>
        )}
        {status === "error" && (
          <div className="flex items-center gap-2 text-red-600 text-sm font-medium bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {errorMsg || "Failed to send. Is the backend running?"}
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={status === "sending" || !form.subject.trim() || !form.body.trim()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <Send className="h-4 w-4" />
            {status === "sending" ? "Sending…" : "Send to Advisor System"}
          </button>
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border border-border bg-muted hover:bg-muted/60 transition-colors"
          >
            <RotateCcw className="h-4 w-4" />
            Clear
          </button>
        </div>
      </form>

      {/* How it works */}
      <div className="bg-muted/40 border border-border rounded-xl p-5 space-y-2">
        <p className="text-sm font-semibold text-foreground">How it works</p>
        <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
          <li>Fill in the form above (or pick a demo scenario) and click Send.</li>
          <li>The AI scores the email using sentence embeddings to find the best matching KB article.</li>
          <li>GPT-4o drafts a professional reply grounded in the knowledge base.</li>
          <li>The email lands in <span className="font-medium text-foreground">Email Management</span> — high-confidence emails are flagged for auto-send; others go to advisor review.</li>
        </ol>
      </div>
    </div>
  );
}
