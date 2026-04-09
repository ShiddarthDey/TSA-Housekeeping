import { CheckCircle2, Lock, Mail, Shield, User, UserPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

import AppShell from '@/components/AppShell'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'

type CreateRole = 'supervisor' | 'attendant' | 'houseman' | 'public_area'

function roleOptionLabel(role: CreateRole): string {
  switch (role) {
    case 'supervisor':
      return 'Supervisor'
    case 'attendant':
      return 'Room Attendant'
    case 'houseman':
      return 'Houseman'
    case 'public_area':
      return 'Public Area'
  }
}

const signUpClient = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: 'hk-staff-signup',
  },
})

export default function ManageStaff() {
  const profile = useAuthStore((s) => s.profile)

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<CreateRole>('attendant')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ email: string } | null>(null)

  const canSubmit = useMemo(
    () => email.trim().length > 3 && name.trim().length > 1 && password.length >= 8,
    [email, name, password],
  )
  const canAccess = profile?.role === 'manager' || profile?.role === 'supervisor'
  const canCreateSupervisors = profile?.role === 'manager'
  const roleOptions: CreateRole[] = canCreateSupervisors
    ? ['supervisor', 'attendant', 'houseman', 'public_area']
    : ['attendant', 'houseman', 'public_area']

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || !canAccess) return
    if (role === 'supervisor' && !canCreateSupervisors) return

    setSubmitting(true)
    setError(null)
    setCreated(null)
    try {
      const cleanedEmail = email.trim().toLowerCase()
      const cleanedName = name.trim()

      const { data: signUpData, error: signUpError } = await signUpClient.auth.signUp({
        email: cleanedEmail,
        password,
        options: { data: { full_name: cleanedName } },
      })

      if (signUpError) throw signUpError
      if (!signUpData.user) throw new Error('Signup did not return a user id')

      const { error: profileError } = await supabase.from('profiles').insert({
        id: signUpData.user.id,
        email: cleanedEmail,
        role,
        name: cleanedName,
        is_preregistered: false,
        is_active: true,
      })

      if (profileError) throw profileError

      setCreated({ email: cleanedEmail })

      setEmail('')
      setName('')
      setPassword('')
      setRole('attendant')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create staff account')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AppShell title="Manage staff">
      {!canAccess ? (
        <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4 text-sm text-white/80">
          This page is only available to Managers and Supervisors.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <UserPlus className="h-4 w-4 text-white/80" />
                  Create team member
                </div>
                <div className="mt-1 text-xs text-white/60">Creates a login and assigns a role automatically.</div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-xs text-white/80 ring-1 ring-white/10">
                {profile?.role === 'supervisor' ? <Shield className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                {profile?.role === 'supervisor' ? 'Supervisor' : 'Manager'}
              </span>
            </div>

            {error ? (
              <div className="mt-4 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {error}
              </div>
            ) : null}

            {created ? (
              <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                <div className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="h-4 w-4" />
                  Staff created
                </div>
                <div className="mt-1 text-xs text-white/70">Email: {created.email}</div>
                <div className="mt-1 text-xs text-white/70">
                  Staff created! Give them the email and password to log in.
                </div>
              </div>
            ) : null}

            <form onSubmit={onSubmit} className="mt-5 space-y-3">
              <label className="block">
                <div className="mb-1 text-xs font-medium text-white/70">Email</div>
                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500/40">
                  <Mail className="h-4 w-4 text-white/60" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="staff@hotel.com"
                    autoComplete="email"
                    className="w-full bg-transparent text-sm outline-none placeholder:text-white/40"
                  />
                </div>
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-medium text-white/70">Full Name</div>
                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500/40">
                  <User className="h-4 w-4 text-white/60" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Doe"
                    autoComplete="name"
                    className="w-full bg-transparent text-sm outline-none placeholder:text-white/40"
                  />
                </div>
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-medium text-white/70">Password</div>
                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500/40">
                  <Lock className="h-4 w-4 text-white/60" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    autoComplete="new-password"
                    className="w-full bg-transparent text-sm outline-none placeholder:text-white/40"
                  />
                </div>
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-medium text-white/70">Role</div>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as CreateRole)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500/40"
                >
                  {roleOptions.map((r) => (
                    <option key={r} value={r} className="bg-[#0B1220]">
                      {roleOptionLabel(r)}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="submit"
                disabled={!canSubmit || submitting}
                className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-blue-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? 'Creating…' : 'Create staff'}
              </button>
            </form>

            <div className="mt-4 text-xs text-white/50">
              Uses a separate signup client so your Manager session stays active while you add multiple staff members.
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
