"use client"

import { useEffect, useState } from "react"
import { User } from "lucide-react"

type AdvisorProfile = {
  name: string
  email: string
  department: string
}

const PROFILE_KEY = "advisorProfile"

export default function HeaderTop() {
  const [profile, setProfile] = useState<AdvisorProfile>({
    name: "Dr. Sarah Smith",
    email: "sarah.smith@university.edu",
    department: "Academic Advising Center",
  })

  useEffect(() => {
    if (typeof window === "undefined") return

    // Initial load from localStorage
    const stored = window.localStorage.getItem(PROFILE_KEY)
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Partial<AdvisorProfile>
        setProfile(prev => ({
          name: parsed.name ?? prev.name,
          email: parsed.email ?? prev.email,
          department: parsed.department ?? prev.department,
        }))
      } catch {
        // ignore parse errors
      }
    }

    // Listen for live updates from SettingsTab
    function handleProfileUpdated(event: Event) {
      const custom = event as CustomEvent<AdvisorProfile>
      if (custom.detail) {
        setProfile(custom.detail)
      }
    }

    window.addEventListener(
      "advisor-profile-updated",
      handleProfileUpdated as EventListener,
    )

    return () => {
      window.removeEventListener(
        "advisor-profile-updated",
        handleProfileUpdated as EventListener,
      )
    }
  }, [])

  return (
    <header className="bg-white border-b border-border shadow-sm sticky top-0 z-40">
      <div className="px-8 py-4 flex items-center justify-between">
        {/* Current Date */}
        <p className="text-sm text-muted-foreground">
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>

        {/* Profile */}
        <div className="flex items-center gap-2">
          <div className="h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center">
            <User className="h-5 w-5 text-blue-600" />
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-medium text-foreground">
              {profile.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {profile.department}
            </p>
          </div>
        </div>
      </div>
    </header>
  )
}