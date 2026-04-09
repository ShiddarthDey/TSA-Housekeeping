import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'

import { supabase } from '@/lib/supabaseClient'
import { normalizeRole, type Profile } from '@/utils/domain'

type AuthState = {
  initialized: boolean
  user: User | null
  profile: Profile | null
  error: string | null
  init: () => Promise<void>
  signInWithPassword: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

let authInitialized = false

export const useAuthStore = create<AuthState>((set, get) => ({
  initialized: false,
  user: null,
  profile: null,
  error: null,
  init: async () => {
    if (authInitialized) return
    authInitialized = true

    const { data } = await supabase.auth.getSession()
    const user = data.session?.user ?? null
    set({ user })
    if (user) await get().refreshProfile()

    supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null
      set({ user: nextUser })
      if (!nextUser) set({ profile: null })
      if (nextUser) void get().refreshProfile()
    })

    set({ initialized: true })
  },
  refreshProfile: async () => {
    const user = get().user
    if (!user) {
      set({ profile: null })
      return
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id, role, name, is_active')
      .eq('id', user.id)
      .maybeSingle()

    if (error) {
      set({ error: error.message, profile: null })
      return
    }

    if (!data) {
      set({ error: 'No profile found for this account. Ask a manager to assign your role.', profile: null })
      return
    }

    if ((data as { is_active?: boolean | null }).is_active === false) {
      set({ error: 'Your account has been removed. Ask a manager to re-enable it.', profile: null })
      return
    }

    const nextRole = normalizeRole((data as { role?: unknown }).role)
    if (!nextRole) {
      set({ error: 'Unknown role for this account. Ask a manager to update your role.', profile: null })
      return
    }

    set({ error: null, profile: { ...(data as Profile), role: nextRole } })
  },
  signInWithPassword: async (email, password) => {
    set({ error: null })
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      set({ error: error.message })
      return
    }
    await get().refreshProfile()
  },
  signOut: async () => {
    set({ error: null })
    await supabase.auth.signOut({ scope: 'local' })
    set({ user: null, profile: null })
  },
}))

