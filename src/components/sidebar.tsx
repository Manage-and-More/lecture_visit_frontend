import Link from 'next/link'
import { User } from 'lucide-react'
import { SignOutButton } from '@/components/sign-out-button'
import { createClient } from '@/lib/supabase/server'
import { SidebarNav } from '@/components/sidebar-nav'
export async function Sidebar() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return (
    <aside className="fixed left-0 top-0 h-screen w-56 bg-white/80 backdrop-blur-md shadow-[1px_0_0_0_rgba(0,0,0,0.06)] flex flex-col z-20">
      <Link href="/home" className="px-4 py-4 flex items-center gap-2.5">
        <img
          src="/logo.png"
          alt="Logo"
          className="w-8 h-8 object-contain"
        />
        <span className="font-semibold text-sm tracking-tight text-foreground">Lecture Visit Tool</span>
      </Link>
      <SidebarNav />
      {user && (
        <div className="px-4 py-3 border-t border-black/[0.06]">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex items-center justify-center h-6 w-6 rounded-full bg-black/[0.06]">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <span className="text-xs text-foreground truncate" title={user.email}>
              {user.email}
            </span>
          </div>
          <SignOutButton />
        </div>
      )}
    </aside>
  )
}
