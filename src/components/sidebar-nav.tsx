'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { GraduationCap, BookOpen, Users, Send, Settings, Target, Mail, CalendarDays, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  {
    title: 'Schedule',
    href: '/scheduled',
    icon: Send
  },
  {
    title: 'Outreach',
    href: '/outreach',
    icon: Mail
  },
  {
    title: 'Calendar',
    href: '/calendar',
    icon: CalendarDays
  },
  {
    title: 'My availability',
    href: '/availability',
    icon: Clock
  },
  {
    title: 'Overview',
    href: '/campaigns',
    icon: Target
  },
  {
    title: 'Programs',
    href: '/programs',
    icon: GraduationCap
  },
  {
    title: 'Lectures',
    href: '/lectures',
    icon: BookOpen
  },
  {
    title: 'Professors',
    href: '/professors',
    icon: Users
  },
  {
    title: 'Settings',
    href: '/settings',
    icon: Settings
  }
]

export function SidebarNav() {
  const pathname = usePathname()

  return (
    <nav className="flex-1 px-3 py-2 space-y-0.5">
      {navItems.map((item) => {
        // We consider it active if the path starts with the href, so /programs/1 is still active
        const isActive = pathname.startsWith(item.href)
        
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-200",
              isActive 
                ? "bg-black/[0.04] text-foreground font-medium" 
                : "text-muted-foreground hover:text-foreground hover:bg-black/[0.04]"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.title}
          </Link>
        )
      })}
    </nav>
  )
}
