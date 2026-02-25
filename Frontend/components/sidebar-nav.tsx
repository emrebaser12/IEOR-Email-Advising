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
    <aside className="w-64 bg-sidebar border-r border-sidebar-border h-screen flex flex-col sticky top-0">
      {/* Logo/Title */}
      <div className="px-6 py-8 border-b border-sidebar-border">
        <h1 className="text-xl font-bold text-sidebar-primary">Email Advising</h1>
        <p className="text-xs text-sidebar-foreground/60 mt-1">Columbia IEOR 2025</p>
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 px-4 py-6 space-y-2">
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-left font-medium text-sm",
                activeTab === item.id
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </button>
          )
        })}
      </nav>

      {/* Footer with Credits - next to N logo */}
      <div className="px-5 pt-5 pb-6 border-t border-sidebar-border bg-sidebar">
        <p className="text-[9px] text-sidebar-foreground/70 leading-tight text-right">
          Developed by Emre Baser, Lara Jones,<br />Mayyada Shair, Samuel Velez-Hurtado
        </p>
      </div>
    </aside>
  )
}