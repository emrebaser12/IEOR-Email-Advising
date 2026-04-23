"use client";

import { useEffect, useState } from "react";
import SidebarNav from "@/components/sidebar-nav";
import HeaderTop from "@/components/header-top";
import MetricsCards from "@/components/metrics-cards";
import EmailsTab from "@/components/emails-tab";
import AnalyticsTab from "@/components/analytics-tab";
import SettingsTab from "@/components/settings-tab";
import ExpoTab from "@/components/expo-tab";

const VALID_TABS = new Set(["dashboard", "emails", "analytics", "settings", "expo"]);

export default function Page() {
  const [activeTab, setActiveTab] = useState("dashboard");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab && VALID_TABS.has(tab)) {
      setActiveTab(tab);
      params.delete("tab");
      const newQuery = params.toString();
      window.history.replaceState(
        null,
        "",
        newQuery ? `?${newQuery}` : window.location.pathname
      );
    }
  }, []);

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar Navigation */}
      <SidebarNav activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <HeaderTop />

        {/* Content Area */}
        <main className="flex-1 min-h-0 overflow-hidden flex flex-col px-8 py-8">
          {/* Dashboard Tab */}
          {activeTab === "dashboard" && (
            <div className="space-y-8 animate-fade-in overflow-y-auto flex-1">
              <div>
                <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
                <p className="mt-2 text-muted-foreground">
                  High-level overview of student email volume and advisor workload
                </p>
              </div>
              <MetricsCards />
              <p className="text-xs text-muted-foreground">
                For detailed email review, use the Email Management tab.
              </p>
            </div>
          )}

          {/* Emails Tab */}
          {activeTab === "emails" && <div className="animate-fade-in flex-1 min-h-0 flex flex-col"><EmailsTab /></div>}

          {/* Analytics Tab */}
          {activeTab === "analytics" && <div className="animate-fade-in overflow-y-auto flex-1"><AnalyticsTab /></div>}

          {/* Settings Tab */}
          {activeTab === "settings" && <div className="animate-fade-in overflow-y-auto flex-1"><SettingsTab /></div>}

          {/* Senior Design Expo Tab */}
          {activeTab === "expo" && <div className="animate-fade-in overflow-y-auto flex-1"><ExpoTab /></div>}
        </main>
      </div>
    </div>
  );
}
