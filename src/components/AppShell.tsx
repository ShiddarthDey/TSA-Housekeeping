import { LogOut, Menu, Shield, User, X } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { useAuthStore } from '@/stores/authStore'
import { roleLabel } from '@/utils/domain'

export default function AppShell({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const profile = useAuthStore((s) => s.profile)
  const signOut = useAuthStore((s) => s.signOut)
  const [menuOpen, setMenuOpen] = useState(false)

  const canSeeStaff = profile && (profile.role === 'manager' || profile.role === 'supervisor')
  const canSeeWorkHistory = profile && (profile.role === 'manager' || profile.role === 'supervisor')
  const canSeeRoomBoard =
    profile &&
    (profile.role === 'supervisor' ||
      profile.role === 'attendant' ||
      profile.role === 'ra' ||
      profile.role === 'houseman' ||
      profile.role === 'public_area')
  const canSeeProductivity = profile && profile.role !== 'manager'

  return (
    <div className="min-h-dvh bg-[#0B1220] text-[#E5E7EB]">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0B1220]/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm text-white/60">Housekeeping</div>
            <div className="truncate text-base font-semibold">{title}</div>
          </div>

          <div className="hidden items-center gap-2 lg:flex">
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
            {profile ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-xs text-white/80 ring-1 ring-white/10">
                {profile.role === 'supervisor' ? <Shield className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                {roleLabel(profile.role)}
              </span>
            ) : null}

            {profile?.role === 'supervisor' ? (
              <span className="max-w-[11rem] truncate rounded-full bg-white/5 px-2.5 py-1 text-xs text-white/80 ring-1 ring-white/10">
                {profile.name ?? user?.email ?? 'Supervisor'}
              </span>
            ) : null}

            {canSeeStaff ? (
              <Link to="/staff" className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10">
                Staff
              </Link>
            ) : null}

            {canSeeWorkHistory ? (
              <Link
                to="/work-history"
                className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
              >
                Work history
              </Link>
            ) : null}

            {profile?.role === 'manager' ? (
              <Link
                to={location.pathname.startsWith('/dashboard') ? '/rooms' : '/dashboard'}
                className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
              >
                {location.pathname.startsWith('/dashboard') ? 'Rooms' : 'Dashboard'}
              </Link>
            ) : null}

            {canSeeRoomBoard ? (
              <Link
                to="/rooms"
                className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
              >
                Room board
              </Link>
            ) : null}

            {canSeeProductivity ? (
              <Link
                to="/productivity"
                className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
              >
                Productivity
              </Link>
            ) : null}

            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>

          <div className="flex items-center gap-2 lg:hidden">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
              aria-expanded={menuOpen}
              aria-label="Menu"
            >
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              Menu
            </button>
          </div>
        </div>

        {menuOpen ? (
          <div className="border-t border-white/10 bg-[#0B1220]/95 backdrop-blur lg:hidden">
            <div className="mx-auto max-w-3xl px-4 py-3">
              {actions ? <div className="mb-2 flex items-center gap-2">{actions}</div> : null}

              {profile ? (
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-white/60">Signed in as</div>
                    <div className="truncate text-sm font-semibold text-white">{profile.name ?? user?.email ?? 'User'}</div>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-xs text-white/80 ring-1 ring-white/10">
                    {profile.role === 'supervisor' ? <Shield className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                    {roleLabel(profile.role)}
                  </span>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-2">
                {canSeeRoomBoard ? (
                  <Link
                    to="/rooms"
                    onClick={() => setMenuOpen(false)}
                    className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
                  >
                    Room board
                  </Link>
                ) : null}

                {profile?.role === 'manager' ? (
                  <Link
                    to={location.pathname.startsWith('/dashboard') ? '/rooms' : '/dashboard'}
                    onClick={() => setMenuOpen(false)}
                    className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
                  >
                    {location.pathname.startsWith('/dashboard') ? 'Rooms' : 'Dashboard'}
                  </Link>
                ) : null}

                {canSeeProductivity ? (
                  <Link
                    to="/productivity"
                    onClick={() => setMenuOpen(false)}
                    className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
                  >
                    Productivity
                  </Link>
                ) : null}

                {canSeeStaff ? (
                  <Link
                    to="/staff"
                    onClick={() => setMenuOpen(false)}
                    className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
                  >
                    Staff
                  </Link>
                ) : null}

                {canSeeWorkHistory ? (
                  <Link
                    to="/work-history"
                    onClick={() => setMenuOpen(false)}
                    className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
                  >
                    Work history
                  </Link>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  void signOut()
                }}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </div>
        ) : null}
      </header>

      <main className="mx-auto max-w-3xl px-4 py-4">{children}</main>
    </div>
  )
}

