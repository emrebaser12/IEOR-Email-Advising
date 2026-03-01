"use client"
import { LayoutDashboard, Mail, BarChart3, Settings } from "lucide-react"
import { cn } from "@/lib/utils"

interface SidebarNavProps {
  activeTab: string
  onTabChange: (tab: string) => void
}

export default function SidebarNav({ activeTab, onTabChange }: SidebarNavProps) {
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "emails", label: "Email Management", icon: Mail },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "settings", label: "Settings", icon: Settings },
  ]

  return (
    <aside className="w-56 border-r border-sidebar-border h-screen flex flex-col sticky top-0" style={{ backgroundColor: 'var(--sidebar)' }}>
      {/* Logo/Title */}
      <div className="px-6 py-8 border-b border-sidebar-border">
        <h1 className="text-2xl font-extrabold text-sidebar-foreground tracking-tight">Email Advising</h1>
        <p className="text-xs text-sidebar-foreground/50 mt-1">Columbia IEOR 2025</p>
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 px-3 py-6 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = activeTab === item.id
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all text-left text-sm font-medium",
                isActive
                  ? "bg-blue-600 text-white shadow-md"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
            >
              <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-white" : "text-sidebar-foreground/50")} />
              {item.label}
            </button>
          )
        })}
      </nav>

      {/* Footer with Credits */}
      <div className="px-5 pt-4 pb-6 border-t border-sidebar-border">
        <p className="text-[9px] text-sidebar-foreground/40 leading-tight text-center">
          Developed by Emre Baser, Lara Jones,<br />Mayyada Shair, Yasemin Yuksel
        </p>
      </div>
    </aside>
  )
}