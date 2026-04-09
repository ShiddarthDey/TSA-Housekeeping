import { BarChart3, Lock, Mail, Shield, User } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import type { Role } from '@/utils/domain'

export default function Login() {
  const navigate = useNavigate()
  const initialized = useAuthStore((s) => s.initialized)
  const user = useAuthStore((s) => s.user)
  const profile = useAuthStore((s) => s.profile)
  const signInWithPassword = useAuthStore((s) => s.signInWithPassword)
  const signOut = useAuthStore((s) => s.signOut)
  const error = useAuthStore((s) => s.error)

  const [mode, setMode] = useState<'manager' | 'supervisor' | 'attendant' | 'houseman' | 'public_area' | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [canCompleteRegistration, setCanCompleteRegistration] = useState(false)
  const [regPassword, setRegPassword] = useState('')
  const [regPassword2, setRegPassword2] = useState('')
  const [registering, setRegistering] = useState(false)

  const canSubmit = useMemo(() => email.trim().length > 3 && password.length > 3, [email, password])

  useEffect(() => {
    if (!initialized) return
    if (!user || !profile) return
    if (mode) return
    navigate(profile.role === 'manager' ? '/dashboard' : '/rooms', { replace: true })
  }, [initialized, mode, navigate, profile, user])

  function isAuthorized(expected: NonNullable<typeof mode>, actual: Role): boolean {
    if (expected === 'manager') return actual === 'manager'
    if (expected === 'supervisor') return actual === 'supervisor'
    if (expected === 'attendant') return actual === 'attendant' || actual === 'ra'
    if (expected === 'houseman') return actual === 'houseman'
    return actual === 'public_area'
  }

  function modeLabel(v: NonNullable<typeof mode>): string {
    switch (v) {
      case 'manager':
        return 'Manager'
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

  function unauthorizedMessage(v: NonNullable<typeof mode>): string {
    switch (v) {
      case 'manager':
        return 'Unauthorized: You do not have Manager permissions.'
      case 'supervisor':
        return 'Unauthorized: You do not have Supervisor permissions.'
      case 'attendant':
        return 'Unauthorized: You do not have Room Attendant permissions.'
      case 'houseman':
        return 'Unauthorized: You do not have Houseman permissions.'
      case 'public_area':
        return 'Unauthorized: You do not have Public Area permissions.'
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!mode) return
    if (!canSubmit) return
    setLocalError(null)
    setCanCompleteRegistration(false)
    setSubmitting(true)
    try {
      const cleanedEmail = email.trim().toLowerCase()
      await signInWithPassword(cleanedEmail, password)
      const { profile, user, error } = useAuthStore.getState()

      if (!user || !profile) {
        const msg = error ?? ''
        if (msg.toLowerCase().includes('invalid login credentials') || msg.toLowerCase().includes('invalid')) {
          const { data } = await supabase
            .from('profiles')
            .select('email')
            .eq('email', cleanedEmail)
            .eq('is_preregistered', true)
            .maybeSingle()
          setCanCompleteRegistration(!!data)
        }
        return
      }

      if (!isAuthorized(mode, profile.role)) {
        setLocalError(unauthorizedMessage(mode))
        await signOut()
        return
      }

      navigate(profile.role === 'manager' ? '/dashboard' : '/rooms', { replace: true })
    } finally {
      setSubmitting(false)
    }
  }

  async function completeRegistration() {
    if (!mode) return
    const cleanedEmail = email.trim().toLowerCase()
    const p1 = regPassword
    const p2 = regPassword2
    if (p1.length < 8) {
      setLocalError('Password must be at least 8 characters.')
      return
    }
    if (p1 !== p2) {
      setLocalError('Passwords do not match.')
      return
    }

    setLocalError(null)
    setRegistering(true)
    try {
      const { data, error } = await supabase.auth.signUp({ email: cleanedEmail, password: p1 })
      if (error) throw error
      if (!data.user) throw new Error('Signup did not return a user id')

      const { error: claimError } = await supabase
        .from('profiles')
        .update({ id: data.user.id, is_preregistered: false })
        .eq('email', cleanedEmail)
        .eq('is_preregistered', true)

      if (claimError) throw claimError

      await useAuthStore.getState().refreshProfile()
      const { profile } = useAuthStore.getState()
      if (!profile) throw new Error('Profile not found after registration')

      if (!isAuthorized(mode, profile.role)) {
        setLocalError(unauthorizedMessage(mode))
        await signOut()
        return
      }

      navigate(profile.role === 'manager' ? '/dashboard' : '/rooms', { replace: true })
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Failed to complete registration')
    } finally {
      setRegistering(false)
    }
  }

  return (
    <div className="min-h-dvh bg-[#0B1220] text-[#E5E7EB] flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#111A2E] p-6 shadow-lg shadow-black/20">
        <div className="text-sm text-white/60">Housekeeping</div>
        <h1 className="mt-1 text-xl font-semibold">{mode ? `Sign in as ${modeLabel(mode)}` : 'Choose login type'}</h1>
        <p className="mt-1 text-sm text-white/70">
          {mode ? 'Use your assigned account to continue.' : 'Pick the account type you are signing in as.'}
        </p>

        {localError || error ? (
          <div className="mt-4 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {localError ?? error}
          </div>
        ) : null}

        {!mode ? (
          <div className="mt-5 space-y-3">
            <button
              type="button"
              onClick={() => setMode('manager')}
              className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white/5 px-4 py-4 text-left ring-1 ring-white/10 hover:bg-white/10"
            >
              <span className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-blue-500/20 text-blue-200 ring-1 ring-blue-400/20">
                  <BarChart3 className="h-5 w-5" />
                </span>
                <span>
                  <div className="text-sm font-semibold text-white">Login as Manager</div>
                  <div className="text-xs text-white/60">Dashboard + full access</div>
                </span>
              </span>
              <span className="text-white/60">›</span>
            </button>

            <button
              type="button"
              onClick={() => setMode('supervisor')}
              className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white/5 px-4 py-4 text-left ring-1 ring-white/10 hover:bg-white/10"
            >
              <span className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-purple-500/20 text-purple-200 ring-1 ring-purple-400/20">
                  <Shield className="h-5 w-5" />
                </span>
                <span>
                  <div className="text-sm font-semibold text-white">Login as Supervisor</div>
                  <div className="text-xs text-white/60">Release rooms after inspection</div>
                </span>
              </span>
              <span className="text-white/60">›</span>
            </button>

            <button
              type="button"
              onClick={() => setMode('attendant')}
              className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white/5 px-4 py-4 text-left ring-1 ring-white/10 hover:bg-white/10"
            >
              <span className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/20">
                  <User className="h-5 w-5" />
                </span>
                <span>
                  <div className="text-sm font-semibold text-white">Login as Room Attendant</div>
                  <div className="text-xs text-white/60">Update assigned rooms</div>
                </span>
              </span>
              <span className="text-white/60">›</span>
            </button>

            <button
              type="button"
              onClick={() => setMode('houseman')}
              className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white/5 px-4 py-4 text-left ring-1 ring-white/10 hover:bg-white/10"
            >
              <span className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/20">
                  <User className="h-5 w-5" />
                </span>
                <span>
                  <div className="text-sm font-semibold text-white">Login as Houseman</div>
                  <div className="text-xs text-white/60">Update assigned rooms</div>
                </span>
              </span>
              <span className="text-white/60">›</span>
            </button>

            <button
              type="button"
              onClick={() => setMode('public_area')}
              className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white/5 px-4 py-4 text-left ring-1 ring-white/10 hover:bg-white/10"
            >
              <span className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/20">
                  <User className="h-5 w-5" />
                </span>
                <span>
                  <div className="text-sm font-semibold text-white">Login as Public Area</div>
                  <div className="text-xs text-white/60">Update assigned rooms</div>
                </span>
              </span>
              <span className="text-white/60">›</span>
            </button>

            <div className="pt-1 text-xs text-white/50">If you can’t sign in, ask a manager to create your account.</div>
          </div>
        ) : (
          <>
            <form onSubmit={onSubmit} className="mt-5 space-y-3">
              <label className="block">
                <div className="mb-1 text-xs font-medium text-white/70">Email</div>
                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500/40">
                  <Mail className="h-4 w-4 text-white/60" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@hotel.com"
                    autoComplete="email"
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
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="w-full bg-transparent text-sm outline-none placeholder:text-white/40"
                  />
                </div>
              </label>

              <button
                type="submit"
                disabled={!canSubmit || submitting}
                className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-blue-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            {canCompleteRegistration ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-sm font-semibold text-white">Complete registration</div>
                <div className="mt-1 text-xs text-white/70">This email was pre-registered. Set a password to activate.</div>

                <div className="mt-3 grid gap-2">
                  <label className="block">
                    <div className="mb-1 text-xs font-medium text-white/70">New password</div>
                    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500/40">
                      <Lock className="h-4 w-4 text-white/60" />
                      <input
                        type="password"
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        placeholder="••••••••"
                        autoComplete="new-password"
                        className="w-full bg-transparent text-sm outline-none placeholder:text-white/40"
                      />
                    </div>
                  </label>

                  <label className="block">
                    <div className="mb-1 text-xs font-medium text-white/70">Confirm password</div>
                    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500/40">
                      <Lock className="h-4 w-4 text-white/60" />
                      <input
                        type="password"
                        value={regPassword2}
                        onChange={(e) => setRegPassword2(e.target.value)}
                        placeholder="••••••••"
                        autoComplete="new-password"
                        className="w-full bg-transparent text-sm outline-none placeholder:text-white/40"
                      />
                    </div>
                  </label>

                  <button
                    type="button"
                    onClick={() => void completeRegistration()}
                    disabled={registering}
                    className="inline-flex w-full items-center justify-center rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {registering ? 'Registering…' : 'Complete Registration'}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="mt-4 flex items-center justify-between gap-3 text-xs text-white/60">
              <button
                type="button"
                onClick={() => {
                  setMode(null)
                  setLocalError(null)
                  setCanCompleteRegistration(false)
                }}
                className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
              >
                Change login type
              </button>
              <span>If you can’t sign in, ask a manager.</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

