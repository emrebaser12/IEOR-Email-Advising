"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useEffect, useState } from "react";
import {
  Trash2,
  Plus,
  Edit2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Globe,
  BookOpen,
  X,
  Check,
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { BACKEND_URL } from "@/lib/constants";

// ---------------------
// Shared auto-send threshold (used by other tabs)
// ---------------------
const CONFIDENCE_THRESHOLD_KEY = "confidenceThresholdPct";
const DEFAULT_CONFIDENCE_THRESHOLD_PCT = 90;

// ---------------------
// Advisor profile storage
// ---------------------
const PROFILE_KEY = "advisorProfile";
const SETTINGS_LAST_SAVED_KEY = "emailSettingsLastSavedAt";

type AdvisorProfile = {
  name: string;
  email: string;
  department: string;
};

const DEFAULT_PROFILE: AdvisorProfile = {
  name: "Dr. Sarah Smith",
  email: "sarah.smith@university.edu",
  department: "Academic Advising Center",
};

// ---------------------
// Knowledge base types (from backend)
// ---------------------
type KBArticle = {
  id: string;
  subject: string;
  categories: string[];
  utterances: string[];
  response_template: string;
  follow_up_questions: string[];
  metadata?: Record<string, any>;
};

// ---------------------
// Reference corpus types (from backend)
// ---------------------
type RCDocument = {
  id: string;
  title: string;
  url: string;
  tags: string[];
  content: string;
};

// ---------------------
// Email client (Gmail API via OAuth) settings
// ---------------------
type EmailSettingsState = {
  auto_send_enabled: boolean;
  auto_send_threshold: number;
  last_synced_at: string | null;
  gmail_connected: boolean;
  gmail_address: string | null;
};
const EMAIL_SETTINGS_CACHE_KEY = "emailSettingsCache";
const DEFAULT_EMAIL_SETTINGS: EmailSettingsState = {
  auto_send_enabled: false,
  auto_send_threshold: DEFAULT_CONFIDENCE_THRESHOLD_PCT,
  last_synced_at: null,
  gmail_connected: false,
  gmail_address: null,
};

function readCachedEmailSettings(): EmailSettingsState {
  if (typeof window === "undefined") {
    return DEFAULT_EMAIL_SETTINGS;
  }
  const cached = window.localStorage.getItem(EMAIL_SETTINGS_CACHE_KEY);
  if (!cached) return DEFAULT_EMAIL_SETTINGS;
  try {
    const parsed = JSON.parse(cached) as Partial<EmailSettingsState>;
    return {
      ...DEFAULT_EMAIL_SETTINGS,
      auto_send_enabled:
        typeof parsed.auto_send_enabled === "boolean"
          ? parsed.auto_send_enabled
          : DEFAULT_EMAIL_SETTINGS.auto_send_enabled,
      auto_send_threshold:
        typeof parsed.auto_send_threshold === "number"
          ? parsed.auto_send_threshold
          : DEFAULT_EMAIL_SETTINGS.auto_send_threshold,
      last_synced_at:
        typeof parsed.last_synced_at === "string" ? parsed.last_synced_at : null,
      gmail_connected:
        typeof parsed.gmail_connected === "boolean"
          ? parsed.gmail_connected
          : DEFAULT_EMAIL_SETTINGS.gmail_connected,
      gmail_address:
        typeof parsed.gmail_address === "string"
          ? parsed.gmail_address
          : DEFAULT_EMAIL_SETTINGS.gmail_address,
    };
  } catch {
    return DEFAULT_EMAIL_SETTINGS;
  }
}

function persistEmailSettings(next: EmailSettingsState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(EMAIL_SETTINGS_CACHE_KEY, JSON.stringify(next));
}

export default function SettingsTab() {
  const { toast } = useToast();

  // Profile state
  const [profile, setProfile] = useState<AdvisorProfile>(DEFAULT_PROFILE);
  const [profileDirty, setProfileDirty] = useState(false);

  // Knowledge Base state (from backend)
  const [kbArticles, setKbArticles] = useState<KBArticle[]>([]);
  const [kbLoading, setKbLoading] = useState(true);
  const [kbExpanded, setKbExpanded] = useState<string | null>(null);
  const [kbEditing, setKbEditing] = useState<string | null>(null);
  const [kbEditData, setKbEditData] = useState<Partial<KBArticle>>({});
  const [kbAdding, setKbAdding] = useState(false);
  const [kbNewData, setKbNewData] = useState<Partial<KBArticle>>({
    id: "",
    subject: "",
    categories: [],
    utterances: [],
    response_template: "",
    follow_up_questions: [],
  });

  // Reference Corpus state (from backend)
  const [rcDocs, setRcDocs] = useState<RCDocument[]>([]);
  const [rcLoading, setRcLoading] = useState(true);
  const [rcExpanded, setRcExpanded] = useState<string | null>(null);
  const [rcEditing, setRcEditing] = useState<string | null>(null);
  const [rcEditData, setRcEditData] = useState<Partial<RCDocument>>({});
  const [rcAdding, setRcAdding] = useState(false);
  const [rcNewData, setRcNewData] = useState<Partial<RCDocument>>({
    id: "",
    title: "",
    url: "",
    tags: [],
    content: "",
  });
  const [fetchingUrl, setFetchingUrl] = useState(false);

  // Email client / Gmail OAuth settings
  const [emailSettings, setEmailSettings] = useState<EmailSettingsState>(() =>
    readCachedEmailSettings()
  );
  const [savingEmailSettings, setSavingEmailSettings] = useState(false);
  const [emailSettingsError, setEmailSettingsError] = useState<string | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [emailSettingsDirty, setEmailSettingsDirty] = useState(false);
  const [checkingGmailStatus, setCheckingGmailStatus] = useState(true);

  // ---------------------
  // Load all settings on mount
  // ---------------------
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Shared auto-send threshold used by other tabs
    const storedThreshold = window.localStorage.getItem(CONFIDENCE_THRESHOLD_KEY);
    let thresholdPct = DEFAULT_CONFIDENCE_THRESHOLD_PCT;
    if (storedThreshold) {
      const value = Number(storedThreshold);
      if (!Number.isNaN(value)) {
        thresholdPct = value;
      }
    }

    // Load profile
    const storedProfile = window.localStorage.getItem(PROFILE_KEY);
    if (storedProfile) {
      try {
        const parsed = JSON.parse(storedProfile) as AdvisorProfile;
        setProfile(parsed);
      } catch {
        setProfile(DEFAULT_PROFILE);
      }
    } else {
      setProfile(DEFAULT_PROFILE);
    }

    const storedLastSaved = window.localStorage.getItem(SETTINGS_LAST_SAVED_KEY);
    if (storedLastSaved) {
      setLastSavedAt(storedLastSaved);
    }

    // Load email settings (auto-send + threshold) best-effort
    fetch(`${BACKEND_URL}/email-settings`)
      .then((res) => {
        if (!res.ok) return;
        return res.json();
      })
      .then((data) => {
        if (!data) {
          applyPersistedEmailSettings((prev) => ({
            ...prev,
            auto_send_threshold: thresholdPct,
          }));
          return;
        }
        applyPersistedEmailSettings((prev) => ({
          ...prev,
          auto_send_enabled:
            typeof data.auto_send_enabled === "boolean"
              ? data.auto_send_enabled
              : prev.auto_send_enabled,
          auto_send_threshold:
            typeof data.auto_send_threshold === "number"
              ? Math.round(data.auto_send_threshold * 100)
              : thresholdPct,
          last_synced_at: data.last_synced_at ?? prev.last_synced_at,
        }));
        setEmailSettingsDirty(false);
      })
      .catch(() => {
        applyPersistedEmailSettings((prev) => ({
          ...prev,
          auto_send_threshold: thresholdPct,
        }));
      });

    // Load Gmail connection status (OAuth)
    fetch(`${BACKEND_URL}/gmail/status`)
      .then((res) => {
        if (!res.ok) {
          // API error - treat as disconnected
          applyPersistedEmailSettings((prev) => ({
            ...prev,
            gmail_connected: false,
            gmail_address: null,
          }));
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (!data) return;
        applyPersistedEmailSettings((prev) => ({
          ...prev,
          gmail_connected: !!data.connected,
          gmail_address: data.email_address ?? null,
        }));
        setEmailSettingsDirty(false);
      })
      .catch(() => {
        // Network error or backend not running - reset to disconnected
        applyPersistedEmailSettings((prev) => ({
          ...prev,
          gmail_connected: false,
          gmail_address: null,
        }));
      })
      .finally(() => {
        setCheckingGmailStatus(false);
      });

    // Load Knowledge Base from backend
    loadKnowledgeBase();

    // Load Reference Corpus from backend
    loadReferenceCorpus();
  }, []);

  // ---------------------
  // Knowledge Base API functions
  // ---------------------
  async function loadKnowledgeBase() {
    setKbLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/knowledge-base`);
      if (res.ok) {
        const data = await res.json();
        setKbArticles(data);
      }
    } catch (err) {
      console.error("Failed to load knowledge base:", err);
    } finally {
      setKbLoading(false);
    }
  }

  async function handleAddKbArticle() {
    if (!kbNewData.id || !kbNewData.subject) {
      toast({
        title: "Validation Error",
        description: "ID and Subject are required",
        variant: "destructive",
      });
      return;
    }
    try {
      const res = await fetch(`${BACKEND_URL}/knowledge-base`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: kbNewData.id,
          subject: kbNewData.subject,
          categories: kbNewData.categories || [],
          utterances: kbNewData.utterances || [],
          response_template: kbNewData.response_template || "",
          follow_up_questions: kbNewData.follow_up_questions || [],
        }),
      });
      if (res.ok) {
        toast({ title: "Success", description: "Article added to knowledge base" });
        setKbAdding(false);
        setKbNewData({
          id: "",
          subject: "",
          categories: [],
          utterances: [],
          response_template: "",
          follow_up_questions: [],
        });
        loadKnowledgeBase();
      } else {
        const err = await res.json();
        toast({
          title: "Error",
          description: err.detail || "Failed to add article",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Error",
        description: "Failed to add article",
        variant: "destructive",
      });
    }
  }

  async function handleUpdateKbArticle(articleId: string) {
    try {
      const res = await fetch(`${BACKEND_URL}/knowledge-base/${articleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kbEditData),
      });
      if (res.ok) {
        toast({ title: "Success", description: "Article updated" });
        setKbEditing(null);
        setKbEditData({});
        loadKnowledgeBase();
      } else {
        const err = await res.json();
        toast({
          title: "Error",
          description: err.detail || "Failed to update article",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Error",
        description: "Failed to update article",
        variant: "destructive",
      });
    }
  }

  async function handleDeleteKbArticle(articleId: string) {
    if (!confirm("Are you sure you want to delete this article?")) return;
    try {
      const res = await fetch(`${BACKEND_URL}/knowledge-base/${articleId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast({ title: "Success", description: "Article deleted" });
        loadKnowledgeBase();
      } else {
        toast({
          title: "Error",
          description: "Failed to delete article",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Error",
        description: "Failed to delete article",
        variant: "destructive",
      });
    }
  }

  // ---------------------
  // Reference Corpus API functions
  // ---------------------
  async function loadReferenceCorpus() {
    setRcLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/reference-corpus`);
      if (res.ok) {
        const data = await res.json();
        setRcDocs(data);
      }
    } catch (err) {
      console.error("Failed to load reference corpus:", err);
    } finally {
      setRcLoading(false);
    }
  }

  async function handleFetchUrlContent() {
    if (!rcNewData.url) {
      toast({
        title: "Validation Error",
        description: "Please enter a URL first",
        variant: "destructive",
      });
      return;
    }
    setFetchingUrl(true);
    try {
      const res = await fetch(`${BACKEND_URL}/fetch-url-content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: rcNewData.url }),
      });
      if (res.ok) {
        const data = await res.json();
        setRcNewData((prev) => ({
          ...prev,
          title: data.title || prev.title,
          content: data.content || prev.content,
          id:
            prev.id ||
            data.title?.toLowerCase().replace(/\s+/g, "_").slice(0, 50) ||
            "",
        }));
        toast({ title: "Success", description: "Content fetched from URL" });
      } else {
        const err = await res.json();
        toast({
          title: "Error",
          description: err.detail || "Failed to fetch URL",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Error",
        description: "Failed to fetch URL content",
        variant: "destructive",
      });
    } finally {
      setFetchingUrl(false);
    }
  }

  async function handleAddRcDocument() {
    if (!rcNewData.id || !rcNewData.title) {
      toast({
        title: "Validation Error",
        description: "ID and Title are required",
        variant: "destructive",
      });
      return;
    }
    try {
      const res = await fetch(`${BACKEND_URL}/reference-corpus`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: rcNewData.id,
          title: rcNewData.title,
          url: rcNewData.url || "",
          tags: rcNewData.tags || [],
          content: rcNewData.content || "",
        }),
      });
      if (res.ok) {
        toast({ title: "Success", description: "Document added to reference corpus" });
        setRcAdding(false);
        setRcNewData({ id: "", title: "", url: "", tags: [], content: "" });
        loadReferenceCorpus();
      } else {
        const err = await res.json();
        toast({
          title: "Error",
          description: err.detail || "Failed to add document",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Error",
        description: "Failed to add document",
        variant: "destructive",
      });
    }
  }

  async function handleUpdateRcDocument(docId: string) {
    try {
      const res = await fetch(`${BACKEND_URL}/reference-corpus/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rcEditData),
      });
      if (res.ok) {
        toast({ title: "Success", description: "Document updated" });
        setRcEditing(null);
        setRcEditData({});
        loadReferenceCorpus();
      } else {
        const err = await res.json();
        toast({
          title: "Error",
          description: err.detail || "Failed to update document",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Error",
        description: "Failed to update document",
        variant: "destructive",
      });
    }
  }

  async function handleDeleteRcDocument(docId: string) {
    if (!confirm("Are you sure you want to delete this document?")) return;
    try {
      const res = await fetch(`${BACKEND_URL}/reference-corpus/${docId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast({ title: "Success", description: "Document deleted" });
        loadReferenceCorpus();
      } else {
        toast({
          title: "Error",
          description: "Failed to delete document",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Error",
        description: "Failed to delete document",
        variant: "destructive",
      });
    }
  }

  // ---------------------
  // Profile interactions
  // ---------------------
  function updateField<K extends keyof AdvisorProfile>(key: K) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = { ...profile, [key]: e.target.value };
      setProfile(next);
      setProfileDirty(true);
    };
  }

  function saveProfile() {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    setProfileDirty(false);
    window.dispatchEvent(
      new CustomEvent("advisor-profile-updated", { detail: profile })
    );
    toast({ title: "Success", description: "Profile updated" });
  }

  // ---------------------
  // Email Client settings interactions (Gmail OAuth)
  // ---------------------
  function applyPersistedEmailSettings(
    updater: (prev: EmailSettingsState) => EmailSettingsState,
  ) {
    setEmailSettings((prev) => {
      const next = updater(prev);
      persistEmailSettings(next);
      return next;
    });
  }

  function updateEmailSettings<K extends keyof EmailSettingsState>(
    key: K,
    value: EmailSettingsState[K]
  ) {
    setEmailSettings((prev) => {
      if (prev[key] === value) return prev;
      setEmailSettingsDirty(true);
      return { ...prev, [key]: value };
    });
  }

  async function handleSaveEmailSettings() {
    setSavingEmailSettings(true);
    setEmailSettingsError(null);
    setSettingsSaved(false);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        CONFIDENCE_THRESHOLD_KEY,
        String(emailSettings.auto_send_threshold)
      );
    }

    try {
      const payload: any = {
        auto_send_enabled: emailSettings.auto_send_enabled,
        auto_send_threshold: emailSettings.auto_send_threshold / 100,
      };

      const res = await fetch(`${BACKEND_URL}/email-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        applyPersistedEmailSettings((prev) => ({
          ...prev,
          auto_send_enabled:
            typeof data.auto_send_enabled === "boolean"
              ? data.auto_send_enabled
              : prev.auto_send_enabled,
          auto_send_threshold:
            typeof data.auto_send_threshold === "number"
              ? Math.round(data.auto_send_threshold * 100)
              : prev.auto_send_threshold,
        }));
        setEmailSettingsDirty(false);
        const timestamp = new Date().toISOString();
        setLastSavedAt(timestamp);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(SETTINGS_LAST_SAVED_KEY, timestamp);
        }
      } else {
        const text = await res.text();
        console.error("Failed to update /email-settings:", text);
      }
    } catch (err) {
      console.error("Error calling /email-settings:", err);
    } finally {
      setSavingEmailSettings(false);
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2000);
    }
  }

  async function handleConnectGmail() {
    setEmailSettingsError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/gmail/auth-url`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to start Gmail connection");
      }
      const data = await res.json();
      if (data.auth_url) {
        window.location.href = data.auth_url;
      } else {
        throw new Error("auth_url missing from backend response");
      }
    } catch (err: any) {
      setEmailSettingsError(err?.message ?? "Unable to open Gmail authorization");
    }
  }

  async function handleDisconnectGmail() {
    setEmailSettingsError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/gmail/disconnect`, {
        method: "POST",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to disconnect Gmail");
      }
      applyPersistedEmailSettings((prev) => ({
        ...prev,
        gmail_connected: false,
        gmail_address: null,
        last_synced_at: null,
      }));
    } catch (err: any) {
      setEmailSettingsError(err?.message ?? "Unable to disconnect Gmail");
    }
  }

  // ---------------------
  // Helper: Parse comma-separated string to array
  // ---------------------
  function parseCommaSeparated(str: string): string[] {
    return str
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  // ---------------------
  // Render
  // ---------------------
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-foreground">Settings</h2>
        <p className="text-muted-foreground mt-1">
          Configure your email advising system
        </p>
      </div>

      {/* Core settings first: email + profile */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Email Client Integration (Gmail OAuth + auto-send threshold) */}
        <Card className="flex flex-col h-full">
          <CardHeader>
            <CardTitle>Email Client Integration</CardTitle>
            <CardDescription className="mt-1">
              Connect a Gmail inbox via OAuth and control auto-send behavior.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 flex flex-col flex-1">
            {emailSettingsError && (
              <p className="text-xs text-red-600 whitespace-pre-line">
                {emailSettingsError}
              </p>
            )}

            <div className="flex flex-col gap-3 rounded-md bg-gray-50 px-3 py-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium">
                  {emailSettings.gmail_connected
                    ? "Connected to Gmail"
                    : "Not connected to Gmail"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {emailSettings.gmail_connected && emailSettings.gmail_address
                    ? emailSettings.gmail_address
                    : "Use your Google account to authorize access via OAuth."}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                <Button
                  variant={emailSettings.gmail_connected ? "outline" : "default"}
                  className={
                    emailSettings.gmail_connected
                      ? ""
                      : "bg-blue-600 hover:bg-blue-700"
                  }
                  onClick={handleConnectGmail}
                  disabled={checkingGmailStatus}
                >
                  {checkingGmailStatus ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : emailSettings.gmail_connected ? (
                    "Reconnect"
                  ) : (
                    "Connect Gmail"
                  )}
                </Button>
                {emailSettings.gmail_connected && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={handleDisconnectGmail}
                    disabled={checkingGmailStatus}
                  >
                    Disconnect
                  </Button>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Auto-send replies</p>
                <p className="text-xs text-muted-foreground">
                  When enabled, high-confidence replies will be sent automatically
                  from the connected Gmail account.
                </p>
              </div>
              <Switch
                checked={emailSettings.auto_send_enabled}
                onCheckedChange={(checked) =>
                  updateEmailSettings("auto_send_enabled", checked)
                }
              />
            </div>

            <div>
              <label className="text-sm font-medium">
                Auto-send confidence threshold
              </label>
              <div className="mt-2 flex items-center gap-2 sm:gap-3">
                <Slider
                  className="flex-1"
                  value={[emailSettings.auto_send_threshold]}
                  onValueChange={([v]) =>
                    updateEmailSettings("auto_send_threshold", v)
                  }
                  max={100}
                  min={50}
                  step={1}
                />
                <span className="w-12 text-right text-sm font-semibold text-blue-600">
                  {emailSettings.auto_send_threshold}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Emails with confidence score greater than or equal to this threshold can be auto-sent.
              </p>
            </div>

            <div className="mt-auto pt-4 flex items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground">
                Last saved:{" "}
                {lastSavedAt
                  ? new Date(lastSavedAt).toLocaleString("en-US", {
                      timeZone: "America/New_York",
                      month: "2-digit",
                      day: "2-digit",
                      year: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: true,
                    })
                  : "Not yet"}
              </div>
              <div className="flex items-center gap-3">
                {settingsSaved && (
                  <span className="text-xs font-semibold text-green-600">
                    Settings saved
                  </span>
                )}
                <Button
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={handleSaveEmailSettings}
                  disabled={savingEmailSettings || !emailSettingsDirty}
                >
                  {savingEmailSettings ? "Saving..." : "Save Settings"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Advisor Profile */}
        <Card className="flex flex-col h-full">
          <CardHeader>
            <CardTitle>Advisor Profile</CardTitle>
            <CardDescription className="mt-1">
              This information is shown in signatures and in the app header.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col flex-1">
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Name</label>
                <Input
                  className="mt-2"
                  value={profile.name}
                  onChange={updateField("name")}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Email</label>
                <Input
                  className="mt-2"
                  value={profile.email}
                  onChange={updateField("email")}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Department</label>
                <Input
                  className="mt-2"
                  value={profile.department}
                  onChange={updateField("department")}
                />
              </div>
            </div>
            <div className="mt-auto pt-4">
              <Button
                className="bg-blue-600 hover:bg-blue-700"
                onClick={saveProfile}
                disabled={!profileDirty}
              >
                {profileDirty ? "Update Profile" : "Profile Updated"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Knowledge Base Card - Full Width */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-blue-600" />
              <div>
                <CardTitle>Knowledge Base</CardTitle>
                <CardDescription>
                  Manage Q&A articles that power AI responses ({kbArticles.length}{" "}
                  articles)
                </CardDescription>
              </div>
            </div>
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => setKbAdding(true)}
            >
              <Plus className="h-4 w-4 mr-1" /> Add Article
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {kbLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Add New Article Form */}
              {kbAdding && (
                <div className="border rounded-lg p-4 space-y-3 bg-blue-50 mb-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-blue-800">
                      Add New Article
                    </p>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setKbAdding(false)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium">
                        ID (unique identifier)
                      </label>
                      <Input
                        className="mt-1"
                        placeholder="e.g., course_registration"
                        value={kbNewData.id || ""}
                        onChange={(e) =>
                          setKbNewData({ ...kbNewData, id: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium">Subject</label>
                      <Input
                        className="mt-1"
                        placeholder="e.g., Course Registration Help"
                        value={kbNewData.subject || ""}
                        onChange={(e) =>
                          setKbNewData({ ...kbNewData, subject: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium">
                      Categories (comma-separated)
                    </label>
                    <Input
                      className="mt-1"
                      placeholder="e.g., registration, courses"
                      value={(kbNewData.categories || []).join(", ")}
                      onChange={(e) =>
                        setKbNewData({
                          ...kbNewData,
                          categories: parseCommaSeparated(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium">
                      Utterances / Keywords (comma-separated)
                    </label>
                    <Input
                      className="mt-1"
                      placeholder="e.g., how to register, enroll in class"
                      value={(kbNewData.utterances || []).join(", ")}
                      onChange={(e) =>
                        setKbNewData({
                          ...kbNewData,
                          utterances: parseCommaSeparated(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium">Response Template</label>
                    <textarea
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      rows={4}
                      placeholder="Hello {student_name},..."
                      value={kbNewData.response_template || ""}
                      onChange={(e) =>
                        setKbNewData({
                          ...kbNewData,
                          response_template: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setKbAdding(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700"
                      onClick={handleAddKbArticle}
                    >
                      <Check className="h-4 w-4 mr-1" /> Add Article
                    </Button>
                  </div>
                </div>
              )}

              {/* Article List */}
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {kbArticles.map((article) => (
                  <div key={article.id} className="border rounded-lg bg-gray-50">
                    <div
                      className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-100"
                      onClick={() =>
                        setKbExpanded(
                          kbExpanded === article.id ? null : article.id
                        )
                      }
                    >
                      <div className="flex-1">
                        <p className="text-sm font-medium">{article.subject}</p>
                        <p className="text-xs text-muted-foreground">
                          ID: {article.id} • {article.categories.length} categories
                          • {article.utterances.length} utterances
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            setKbEditing(article.id);
                            setKbExpanded(article.id);
                            setKbEditData({
                              subject: article.subject,
                              categories: article.categories,
                              utterances: article.utterances,
                              response_template: article.response_template,
                              follow_up_questions: article.follow_up_questions,
                            });
                          }}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-red-600 hover:text-red-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteKbArticle(article.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        {kbExpanded === article.id ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </div>

                    {/* Expanded Content */}
                    {kbExpanded === article.id && (
                      <div className="px-3 pb-3 pt-1 border-t space-y-2">
                        {kbEditing === article.id ? (
                          // Edit Mode
                          <div className="space-y-3">
                            <div>
                              <label className="text-xs font-medium">Subject</label>
                              <Input
                                className="mt-1"
                                value={kbEditData.subject || ""}
                                onChange={(e) =>
                                  setKbEditData({
                                    ...kbEditData,
                                    subject: e.target.value,
                                  })
                                }
                              />
                            </div>
                            <div>
                              <label className="text-xs font-medium">
                                Categories
                              </label>
                              <Input
                                className="mt-1"
                                value={(kbEditData.categories || []).join(", ")}
                                onChange={(e) =>
                                  setKbEditData({
                                    ...kbEditData,
                                    categories: parseCommaSeparated(e.target.value),
                                  })
                                }
                              />
                            </div>
                            <div>
                              <label className="text-xs font-medium">
                                Utterances
                              </label>
                              <Input
                                className="mt-1"
                                value={(kbEditData.utterances || []).join(", ")}
                                onChange={(e) =>
                                  setKbEditData({
                                    ...kbEditData,
                                    utterances: parseCommaSeparated(e.target.value),
                                  })
                                }
                              />
                            </div>
                            <div>
                              <label className="text-xs font-medium">
                                Response Template
                              </label>
                              <textarea
                                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                rows={4}
                                value={kbEditData.response_template || ""}
                                onChange={(e) =>
                                  setKbEditData({
                                    ...kbEditData,
                                    response_template: e.target.value,
                                  })
                                }
                              />
                            </div>
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setKbEditing(null);
                                  setKbEditData({});
                                }}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                className="bg-blue-600 hover:bg-blue-700"
                                onClick={() => handleUpdateKbArticle(article.id)}
                              >
                                Save Changes
                              </Button>
                            </div>
                          </div>
                        ) : (
                          // View Mode
                          <>
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">
                                Categories:
                              </p>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {article.categories.map((cat, idx) => (
                                  <span
                                    key={`${cat}-${idx}`}
                                    className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded"
                                  >
                                    {cat}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">
                                Utterances:
                              </p>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {article.utterances.slice(0, 5).map((utt, idx) => (
                                  <span
                                    key={`${utt}-${idx}`}
                                    className="text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded"
                                  >
                                    {utt}
                                  </span>
                                ))}
                                {article.utterances.length > 5 && (
                                  <span className="text-xs text-muted-foreground">
                                    +{article.utterances.length - 5} more
                                  </span>
                                )}
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">
                                Response Preview:
                              </p>
                              <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap line-clamp-3">
                                {article.response_template.slice(0, 200)}
                                {article.response_template.length > 200 && "..."}
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {kbArticles.length === 0 && !kbLoading && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No knowledge base articles yet. Add one to get started.
                  </p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Reference Corpus Card - Full Width */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-green-600" />
              <div>
                <CardTitle>Reference Corpus</CardTitle>
                <CardDescription>
                  Manage source documents and websites for context ({rcDocs.length}{" "}
                  documents)
                </CardDescription>
              </div>
            </div>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700"
              onClick={() => setRcAdding(true)}
            >
              <Plus className="h-4 w-4 mr-1" /> Add Document
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {rcLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Add New Document Form */}
              {rcAdding && (
                <div className="border rounded-lg p-4 space-y-3 bg-green-50 mb-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-green-800">
                      Add New Document
                    </p>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setRcAdding(false)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* URL Fetch Section */}
                  <div className="bg-white rounded-md p-3 border">
                    <label className="text-xs font-medium flex items-center gap-1">
                      <Globe className="h-3 w-3" /> Fetch from URL (optional)
                    </label>
                    <div className="flex gap-2 mt-1">
                      <Input
                        placeholder="https://example.com/page"
                        value={rcNewData.url || ""}
                        onChange={(e) =>
                          setRcNewData({ ...rcNewData, url: e.target.value })
                        }
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleFetchUrlContent}
                        disabled={fetchingUrl || !rcNewData.url}
                      >
                        {fetchingUrl ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Fetch"
                        )}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Enter a URL and click Fetch to auto-populate title and content
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium">
                        ID (unique identifier)
                      </label>
                      <Input
                        className="mt-1"
                        placeholder="e.g., registrar_deadlines"
                        value={rcNewData.id || ""}
                        onChange={(e) =>
                          setRcNewData({ ...rcNewData, id: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium">Title</label>
                      <Input
                        className="mt-1"
                        placeholder="e.g., Registration Deadlines"
                        value={rcNewData.title || ""}
                        onChange={(e) =>
                          setRcNewData({ ...rcNewData, title: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium">
                      Tags (comma-separated)
                    </label>
                    <Input
                      className="mt-1"
                      placeholder="e.g., registration, deadlines, fall"
                      value={(rcNewData.tags || []).join(", ")}
                      onChange={(e) =>
                        setRcNewData({
                          ...rcNewData,
                          tags: parseCommaSeparated(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium">Content</label>
                    <textarea
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      rows={4}
                      placeholder="Paste or type the reference content here..."
                      value={rcNewData.content || ""}
                      onChange={(e) =>
                        setRcNewData({ ...rcNewData, content: e.target.value })
                      }
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRcAdding(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700"
                      onClick={handleAddRcDocument}
                    >
                      <Check className="h-4 w-4 mr-1" /> Add Document
                    </Button>
                  </div>
                </div>
              )}

              {/* Document List */}
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {rcDocs.map((doc) => (
                  <div key={doc.id} className="border rounded-lg bg-gray-50">
                    <div
                      className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-100"
                      onClick={() =>
                        setRcExpanded(rcExpanded === doc.id ? null : doc.id)
                      }
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{doc.title}</p>
                          {doc.url && (
                            <a
                              href={doc.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          ID: {doc.id} • {doc.tags.length} tags •{" "}
                          {doc.content.length} chars
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRcEditing(doc.id);
                            setRcExpanded(doc.id);
                            setRcEditData({
                              title: doc.title,
                              url: doc.url,
                              tags: doc.tags,
                              content: doc.content,
                            });
                          }}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-red-600 hover:text-red-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteRcDocument(doc.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        {rcExpanded === doc.id ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </div>

                    {/* Expanded Content */}
                    {rcExpanded === doc.id && (
                      <div className="px-3 pb-3 pt-1 border-t space-y-2">
                        {rcEditing === doc.id ? (
                          // Edit Mode
                          <div className="space-y-3">
                            <div>
                              <label className="text-xs font-medium">Title</label>
                              <Input
                                className="mt-1"
                                value={rcEditData.title || ""}
                                onChange={(e) =>
                                  setRcEditData({
                                    ...rcEditData,
                                    title: e.target.value,
                                  })
                                }
                              />
                            </div>
                            <div>
                              <label className="text-xs font-medium">URL</label>
                              <Input
                                className="mt-1"
                                value={rcEditData.url || ""}
                                onChange={(e) =>
                                  setRcEditData({
                                    ...rcEditData,
                                    url: e.target.value,
                                  })
                                }
                              />
                            </div>
                            <div>
                              <label className="text-xs font-medium">Tags</label>
                              <Input
                                className="mt-1"
                                value={(rcEditData.tags || []).join(", ")}
                                onChange={(e) =>
                                  setRcEditData({
                                    ...rcEditData,
                                    tags: parseCommaSeparated(e.target.value),
                                  })
                                }
                              />
                            </div>
                            <div>
                              <label className="text-xs font-medium">Content</label>
                              <textarea
                                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                rows={4}
                                value={rcEditData.content || ""}
                                onChange={(e) =>
                                  setRcEditData({
                                    ...rcEditData,
                                    content: e.target.value,
                                  })
                                }
                              />
                            </div>
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setRcEditing(null);
                                  setRcEditData({});
                                }}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                className="bg-green-600 hover:bg-green-700"
                                onClick={() => handleUpdateRcDocument(doc.id)}
                              >
                                Save Changes
                              </Button>
                            </div>
                          </div>
                        ) : (
                          // View Mode
                          <>
                            {doc.url && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground">
                                  URL:
                                </p>
                                <a
                                  href={doc.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-blue-600 hover:underline break-all"
                                >
                                  {doc.url}
                                </a>
                              </div>
                            )}
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">
                                Tags:
                              </p>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {doc.tags.map((tag, idx) => (
                                  <span
                                    key={`${tag}-${idx}`}
                                    className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">
                                Content Preview:
                              </p>
                              <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap line-clamp-3">
                                {doc.content.slice(0, 300)}
                                {doc.content.length > 300 && "..."}
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {rcDocs.length === 0 && !rcLoading && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No reference documents yet. Add one to get started.
                  </p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

    </div>
  );
}