import { ArrowLeft, Brush, CheckCircle2, Shield, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import AppShell from '@/components/AppShell'
import StatusPill from '@/components/StatusPill'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import type { Room, RoomStatus } from '@/utils/domain'
import {
  actionLabel,
  allowedNextStatuses,
  estimatedMinutesForRoomAndTask,
  formatMinutes,
  formatRoomNumber,
  postReleaseRequestLabel,
  roomStatusOrder,
  roomType,
  roomTypeLabel,
  type RoomTask,
  statusLabel,
  taskLabel,
} from '@/utils/domain'

function statusIcon(status: RoomStatus) {
  switch (status) {
    case 'dirty':
      return <TriangleAlert className="h-4 w-4 text-red-200" />
    case 'in_progress':
      return <Brush className="h-4 w-4 text-amber-200" />
    case 'pending_inspection':
      return <Shield className="h-4 w-4 text-blue-200" />
    case 'released':
      return <CheckCircle2 className="h-4 w-4 text-emerald-200" />
  }
}

export default function RoomDetail() {
  const navigate = useNavigate()
  const { roomNumber } = useParams()
  const profile = useAuthStore((s) => s.profile)
  const [room, setRoom] = useState<Room | null>(null)
  const [profileNames, setProfileNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [managerTarget, setManagerTarget] = useState<RoomStatus>('dirty')

  const parsedRoomNumber = useMemo(() => {
    const n = Number(roomNumber)
    return Number.isFinite(n) ? n : null
  }, [roomNumber])

  const allowed = useMemo(() => {
    if (!profile || !room) return []
    if (room.dnd) return []
    return allowedNextStatuses(profile.role, room.status, room.assigned_to === profile.id, room.task ?? null)
  }, [profile, room])

  const loadRoom = useCallback(async () => {
    if (!parsedRoomNumber) {
      setError('Invalid room number')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const { data, error } = await supabase
        .from('rooms')
        .select(
          'room_number, status, task, post_release_request, dnd, dnd_by, dnd_at, assigned_to, inspected_by, released_by, released_at, updated_at',
        )
        .eq('room_number', parsedRoomNumber)
        .maybeSingle()
      if (error) throw error
      if (!data) {
        setError('Room not found (or you do not have access).')
        setRoom(null)
      } else {
        const nextRoom = data as Room
        setRoom(nextRoom)
        setManagerTarget(nextRoom.status)

        const ids = Array.from(
          new Set(
            [nextRoom.assigned_to, nextRoom.inspected_by, nextRoom.released_by, nextRoom.dnd_by].filter(
              (v): v is string => typeof v === 'string' && v.length > 0,
            ),
          ),
        )
        if (ids.length > 0) {
          const { data: profiles, error: profilesError } = await supabase.from('profiles').select('id, name').in('id', ids)
          if (!profilesError) {
            const map: Record<string, string> = {}
            for (const p of (profiles ?? []) as Array<{ id: string; name: string | null }>) map[p.id] = p.name ?? p.id
            setProfileNames(map)
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load room')
    } finally {
      setLoading(false)
    }
  }, [parsedRoomNumber])

  async function transition(toStatus: RoomStatus) {
    if (!room) return
    if (room.dnd) {
      setError('This room is marked DND.')
      return
    }
    const fromStatus = room.status
    const currentTask = (room.task ?? 'checkout') as RoomTask
    setSaving(true)
    setError(null)
    const prev = room
    setRoom({ ...room, status: toStatus })
    try {
      const patch: Partial<Room> = { status: toStatus }
      if (toStatus === 'released' && (profile.role === 'supervisor' || profile.role === 'manager')) {
        patch.released_by = profile.role === 'manager' ? (room.inspected_by ?? profile.id) : profile.id
        patch.released_at = new Date().toISOString()
      }
      const { error } = await supabase
        .from('rooms')
        .update(patch)
        .eq('room_number', room.room_number)
      if (error) throw error

      if (
        (profile.role === 'supervisor' ||
          profile.role === 'attendant' ||
          profile.role === 'ra' ||
          profile.role === 'houseman' ||
          profile.role === 'public_area') &&
        fromStatus === 'dirty' &&
        toStatus === 'in_progress'
      ) {
        const expected = estimatedMinutesForRoomAndTask(room.room_number, currentTask)
        await supabase.from('room_work').insert({
          room_number: room.room_number,
          staff_id: profile.id,
          task: currentTask,
          expected_minutes: expected,
        })
      }

      if (
        (profile.role === 'supervisor' ||
          profile.role === 'attendant' ||
          profile.role === 'ra' ||
          profile.role === 'houseman' ||
          profile.role === 'public_area') &&
        fromStatus === 'in_progress' &&
        toStatus === 'pending_inspection'
      ) {
        const { data } = await supabase
          .from('room_work')
          .select('id')
          .eq('room_number', room.room_number)
          .eq('staff_id', profile.id)
          .is('done_at', null)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        const id = (data as { id?: string } | null)?.id
        if (id) {
          await supabase.from('room_work').update({ done_at: new Date().toISOString() }).eq('id', id)
        }
      }
    } catch (e) {
      setRoom(prev)
      setError(e instanceof Error ? e.message : 'Failed to update status')
    } finally {
      setSaving(false)
    }
  }


  useEffect(() => {
    void loadRoom()
  }, [loadRoom])

  useEffect(() => {
    if (!parsedRoomNumber) return
    const channel = supabase
      .channel(`room-live-${parsedRoomNumber}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, (payload) => {
        const next = payload.new as { room_number?: unknown } | null
        if (Number(next?.room_number) === parsedRoomNumber) void loadRoom()
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loadRoom, parsedRoomNumber])

  if (!profile) {
    return (
      <AppShell title="Room">
        <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4 text-sm text-white/80">
          Your account is missing a profile. Ask a manager to assign your role.
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell title="Room details">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <Link
            to="/rooms"
            className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
          >
            Rooms
          </Link>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="h-28 rounded-2xl border border-white/10 bg-white/5 animate-pulse" />
        ) : room ? (
          <>
            <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-white/60">Room</div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 ring-1 ring-white/10">
                      {statusIcon(room.status)}
                    </div>
                    <div className="text-2xl font-semibold leading-6">{formatRoomNumber(room.room_number)}</div>
                  </div>
                  <div className="mt-2">
                    <StatusPill status={room.status} task={room.task ?? null} postReleaseRequest={room.post_release_request ?? null} />
                  </div>
                  {room.task ? <div className="mt-2 text-xs text-white/70">Task: {taskLabel(room.task)}</div> : null}
                  <div className="mt-1 text-xs text-white/60">
                    {roomTypeLabel(roomType(room.room_number))} ·{' '}
                    {formatMinutes(
                      estimatedMinutesForRoomAndTask(room.room_number, (room.task ?? 'checkout') as RoomTask),
                    )}{' '}
                    mins
                  </div>
                </div>
                <div className="text-right text-xs text-white/60">{room.assigned_to ? `Assigned to: ${profileNames[room.assigned_to] ?? 'Unknown'}` : 'Unassigned'}</div>
              </div>
              {room.inspected_by ? (
                <div className="mt-3 text-xs text-white/60">Supervisor: {profileNames[room.inspected_by] ?? room.inspected_by}</div>
              ) : null}
              {room.released_by ? (
                <div className="mt-1 text-xs text-white/60">Released by: {profileNames[room.released_by] ?? room.released_by}</div>
              ) : null}
              {room.post_release_request ? (
                <div className="mt-1 text-xs text-white/60">{postReleaseRequestLabel(room.post_release_request)}</div>
              ) : null}
              {room.dnd ? (
                <div className="mt-1 text-xs font-semibold text-amber-200">DND</div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4">
              <div className="text-sm font-semibold">Actions</div>
              <div className="mt-2 text-xs text-white/60">Only allowed transitions are enabled for your role.</div>

              {profile.role === 'manager' ? (
                <div className="mt-3 flex flex-col gap-3">
                  <label className="block">
                    <div className="mb-1 text-xs font-medium text-white/70">Set status</div>
                    <select
                      value={managerTarget}
                      onChange={(e) => setManagerTarget(e.target.value as RoomStatus)}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500/40"
                    >
                      {roomStatusOrder
                        .filter((s) => {
                          if (s !== 'released') return true
                          return (room.task ?? 'checkout') === 'checkout'
                        })
                        .map((s) => (
                        <option key={s} value={s} className="bg-[#0B1220]">
                          {statusLabel(s)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={saving || managerTarget === room.status}
                    onClick={() => void transition(managerTarget)}
                    className="rounded-xl bg-blue-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Apply status
                  </button>
                </div>
              ) : allowed.length > 0 ? (
                <div className="mt-3 grid grid-cols-1 gap-2">
                  {allowed.map((next) => (
                    <button
                      key={next}
                      type="button"
                      disabled={saving}
                      onClick={() => void transition(next)}
                      className="rounded-xl bg-blue-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {actionLabel(profile.role, next)}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70">
                  No actions available for this status.
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-6 text-center">
            <div className="text-sm text-white/70">Room not available.</div>
          </div>
        )}
      </div>
    </AppShell>
  )
}

