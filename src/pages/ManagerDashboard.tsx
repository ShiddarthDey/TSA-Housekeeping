import { BarChart3, CheckCircle2, Shield, TriangleAlert, Wrench } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import AppShell from '@/components/AppShell'
import { supabase } from '@/lib/supabaseClient'
import type { Room, RoomStatus } from '@/utils/domain'
import { roomStatusOrder, statusLabel } from '@/utils/domain'

function statusIcon(status: RoomStatus) {
  switch (status) {
    case 'dirty':
      return <TriangleAlert className="h-4 w-4 text-red-200" />
    case 'in_progress':
      return <Wrench className="h-4 w-4 text-amber-200" />
    case 'pending_inspection':
      return <Shield className="h-4 w-4 text-blue-200" />
    case 'released':
      return <CheckCircle2 className="h-4 w-4 text-emerald-200" />
  }
}

export default function ManagerDashboard() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const counts = useMemo(() => {
    const map: Record<RoomStatus, number> = {
      dirty: 0,
      in_progress: 0,
      pending_inspection: 0,
      released: 0,
    }
    for (const r of rooms) map[r.status] += 1
    return map
  }, [rooms])

  const pendingRelease = useMemo(() => rooms.filter((r) => r.status === 'pending_inspection').length, [rooms])

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data, error } = await supabase.from('rooms').select('room_number, status, assigned_to, updated_at')
        if (error) throw error
        setRooms((data ?? []) as Room[])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load rooms')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  return (
    <AppShell title="Dashboard">
      <div className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <BarChart3 className="h-4 w-4 text-white/80" />
                Summary
              </div>
              <div className="mt-1 text-xs text-white/60">Snapshot of today’s room pipeline.</div>
            </div>
            <Link
              to="/rooms"
              className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
            >
              View rooms
            </Link>
          </div>

          {error ? (
            <div className="mt-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-20 rounded-2xl border border-white/10 bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {roomStatusOrder.map((s) => (
                <div key={s} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center gap-2 text-xs text-white/70">
                    {statusIcon(s)}
                    {statusLabel(s)}
                  </div>
                  <div className="mt-2 text-2xl font-semibold leading-6">{counts[s]}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4">
          <div className="text-sm font-semibold">Attention</div>
          <div className="mt-1 text-xs text-white/60">Rooms waiting for supervisor release.</div>
          <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
            Pending inspection: <span className="font-semibold">{pendingRelease}</span>
          </div>
        </div>
      </div>
    </AppShell>
  )
}

