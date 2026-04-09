import { Brush, CheckCircle2, ChevronRight, Search, Shield, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import AppShell from '@/components/AppShell'
import StatusPill from '@/components/StatusPill'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabaseClient'
import type { PostReleaseRequest, Role, Room, RoomStatus, RoomTask } from '@/utils/domain'
import {
  actionLabel,
  allowedNextStatuses,
  canViewAllRooms,
  estimatedMinutesForRoomAndTask,
  formatMinutes,
  formatRoomNumber,
  postReleaseRequestLabel,
  roomStatusOrder,
  roomTypeLabel,
  roomType,
  statusLabel,
  roleLabel,
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

export default function RoomsBoard() {
  const profile = useAuthStore((s) => s.profile)
  const [rooms, setRooms] = useState<Room[]>([])
  const [profileNames, setProfileNames] = useState<Record<string, string>>({})
  const [profileRoles, setProfileRoles] = useState<Record<string, Role>>({})
  const [releaseRequests, setReleaseRequests] = useState<Record<number, PostReleaseRequest | ''>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeStatus, setActiveStatus] = useState<RoomStatus | 'all' | 'requests' | 'stay' | 'dnd'>('all')
  const [search, setSearch] = useState('')
  const [supervisorFilter, setSupervisorFilter] = useState<'all' | 'my' | `sup:${string}`>('all')
  const [staffFilterId, setStaffFilterId] = useState<string>('')

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

  const requestCount = useMemo(() => {
    if (!profile) return 0
    if (profile.role !== 'houseman' && profile.role !== 'public_area') return 0
    return rooms.filter((r) => r.status === 'released' && r.post_release_request === profile.role).length
  }, [profile, rooms])

  const stayCount = useMemo(() => {
    if (!profile) return 0
    if (profile.role !== 'manager' && profile.role !== 'supervisor') return 0
    return rooms.filter((r) => r.status === 'pending_inspection' && r.task && r.task !== 'checkout' && !r.dnd).length
  }, [profile, rooms])

  const dndCount = useMemo(() => {
    if (!profile) return 0
    if (profile.role !== 'manager' && profile.role !== 'supervisor') return 0
    return rooms.filter((r) => Boolean(r.dnd)).length
  }, [profile, rooms])

  const supervisorOptions = useMemo(() => {
    const ids = Array.from(
      new Set(rooms.map((r) => r.inspected_by).filter((v): v is string => typeof v === 'string' && v.length > 0)),
    )
    return ids
      .map((id) => ({ id, name: profileNames[id] ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [profileNames, rooms])

  const staffOptions = useMemo(() => {
    const ids = Array.from(
      new Set(rooms.map((r) => r.assigned_to).filter((v): v is string => typeof v === 'string' && v.length > 0)),
    )
    const rows = ids.map((id) => ({
      id,
      name: profileNames[id] ?? id,
      role: profileRoles[id] ?? null,
    }))

    const supervisors = rows.filter((r) => r.role === 'supervisor').sort((a, b) => a.name.localeCompare(b.name))
    const attendants = rows
      .filter((r) => r.role === 'attendant' || r.role === 'ra')
      .sort((a, b) => a.name.localeCompare(b.name))
    const housemen = rows.filter((r) => r.role === 'houseman').sort((a, b) => a.name.localeCompare(b.name))
    const publicArea = rows.filter((r) => r.role === 'public_area').sort((a, b) => a.name.localeCompare(b.name))
    const unknown = rows.filter((r) => r.role == null).sort((a, b) => a.name.localeCompare(b.name))

    return { supervisors, attendants, housemen, publicArea, unknown }
  }, [profileNames, profileRoles, rooms])

  const myStaffOptions = useMemo(() => {
    if (!profile || profile.role !== 'supervisor') return []
    const ids = Array.from(
      new Set(
        rooms
          .filter((r) => r.inspected_by === profile.id)
          .map((r) => r.assigned_to)
          .filter((v): v is string => typeof v === 'string' && v.length > 0),
      ),
    )
    return ids
      .map((id) => ({ id, name: profileNames[id] ?? id, role: profileRoles[id] ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [profile, profileNames, profileRoles, rooms])

  const filteredRooms = useMemo(() => {
    const s = search.trim()
    let base = rooms

    if (profile.role === 'supervisor') {
      if (supervisorFilter === 'my') base = base.filter((r) => r.inspected_by === profile.id)
      if (supervisorFilter.startsWith('sup:')) base = base.filter((r) => r.inspected_by === supervisorFilter.slice(4))
      if (staffFilterId) base = base.filter((r) => r.inspected_by === profile.id && r.assigned_to === staffFilterId)
    } else if (profile.role === 'manager') {
      if (supervisorFilter.startsWith('sup:')) base = base.filter((r) => r.inspected_by === supervisorFilter.slice(4))
      if (staffFilterId) base = base.filter((r) => r.assigned_to === staffFilterId)
    }

    return base
      .filter((r) => {
        if (activeStatus === 'all') return true
        if (activeStatus === 'requests') return r.status === 'released' && r.post_release_request === profile.role
        if (activeStatus === 'stay') return r.status === 'pending_inspection' && r.task != null && r.task !== 'checkout' && !r.dnd
        if (activeStatus === 'dnd') return Boolean(r.dnd)
        return r.status === activeStatus
      })
      .filter((r) => (s ? String(r.room_number).includes(s) : true))
      .sort((a, b) => a.room_number - b.room_number)
  }, [activeStatus, profile, rooms, search, staffFilterId, supervisorFilter])

  const loadRooms = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    setError(null)
    try {
      const { data, error } = await supabase
        .from('rooms')
        .select(
          'room_number, status, task, post_release_request, dnd, dnd_by, dnd_at, assigned_to, inspected_by, released_by, released_at, updated_at',
        )
      if (error) throw error
      const nextRooms = (data ?? []) as Room[]
      setRooms(nextRooms)

      const ids = Array.from(
        new Set(
          nextRooms
            .flatMap((r) => [
              canViewAllRooms(profile.role) ? r.assigned_to : null,
              r.inspected_by,
              r.released_by,
              r.dnd_by,
            ])
            .filter((v): v is string => typeof v === 'string' && v.length > 0),
        ),
      )

      if (ids.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('id, name, role')
          .in('id', ids)
        if (!profilesError) {
          const map: Record<string, string> = {}
          const roleMap: Record<string, Role> = {}
          for (const p of (profiles ?? []) as Array<{ id: string; name: string | null; role: Role }>) {
            map[p.id] = p.name ?? p.id
            roleMap[p.id] = p.role
          }
          setProfileNames(map)
          setProfileRoles(roleMap)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rooms')
    } finally {
      setLoading(false)
    }
  }, [profile])

  async function transition(roomNumber: number, toStatus: RoomStatus) {
    const current = rooms.find((r) => r.room_number === roomNumber) ?? null
    const fromStatus = current?.status ?? null
    const currentTask = ((current?.task ?? 'checkout') as RoomTask) ?? 'checkout'

    setError(null)
    if (toStatus === 'released' && profile.role === 'supervisor' && current?.inspected_by !== profile.id) {
      setError('You can only release rooms assigned to you.')
      return
    }
    const prev = rooms
    setRooms((rs) => rs.map((r) => (r.room_number === roomNumber ? { ...r, status: toStatus } : r)))

    const patch: Partial<Room> = { status: toStatus }
    if (toStatus === 'released' && (profile.role === 'supervisor' || profile.role === 'manager')) {
      patch.released_by = profile.role === 'manager' ? (current?.inspected_by ?? profile.id) : profile.id
      patch.released_at = new Date().toISOString()
    }

    const { error } = await supabase
      .from('rooms')
      .update(patch)
      .eq('room_number', roomNumber)

    if (error) {
      setRooms(prev)
      setError(error.message)
      return
    }

    if (
      (profile.role === 'supervisor' ||
        profile.role === 'attendant' ||
        profile.role === 'ra' ||
        profile.role === 'houseman' ||
        profile.role === 'public_area') &&
      fromStatus === 'dirty' &&
      toStatus === 'in_progress'
    ) {
      const expected = estimatedMinutesForRoomAndTask(roomNumber, currentTask)
      await supabase.from('room_work').insert({
        room_number: roomNumber,
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
        .eq('room_number', roomNumber)
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
  }

  async function releaseRoom(roomNumber: number, request: PostReleaseRequest | null) {
    if (!profile) return
    const current = rooms.find((r) => r.room_number === roomNumber) ?? null
    if (profile.role === 'supervisor' && current?.inspected_by !== profile.id) {
      setError('You can only release rooms assigned to you.')
      return
    }
    const releasedBy =
      profile.role === 'manager' ? (current?.inspected_by ?? current?.released_by ?? null) : profile.id

    setError(null)
    const prev = rooms
    setRooms((rs) =>
      rs.map((r) =>
        r.room_number === roomNumber
          ? {
              ...r,
              status: 'released',
              released_by: releasedBy,
              released_at: new Date().toISOString(),
              post_release_request: request,
            }
          : r,
      ),
    )

    const patch: Partial<Room> = {
      status: 'released',
      released_by: releasedBy,
      released_at: new Date().toISOString(),
      post_release_request: request,
    }

    const { error } = await supabase.from('rooms').update(patch).eq('room_number', roomNumber)
    if (error) {
      setRooms(prev)
      setError(error.message)
    } else {
      setReleaseRequests((m) => {
        const copy = { ...m }
        delete copy[roomNumber]
        return copy
      })
    }
  }

  async function clearPostReleaseRequest(roomNumber: number) {
    setError(null)
    const prev = rooms
    setRooms((rs) =>
      rs.map((r) => (r.room_number === roomNumber ? { ...r, post_release_request: null } : r)),
    )

    const { error } = await supabase.from('rooms').update({ post_release_request: null }).eq('room_number', roomNumber)
    if (error) {
      setRooms(prev)
      setError(error.message)
    }
  }

  async function markDnd(roomNumber: number) {
    if (!profile) return
    const current = rooms.find((r) => r.room_number === roomNumber) ?? null
    if (!current) return
    if (current.dnd) return
    if (current.status !== 'dirty') return
    if (!current.task || current.task === 'checkout') return
    if (profile.role === 'manager') return
    if (current.assigned_to !== profile.id) return

    setError(null)
    const prev = rooms
    setRooms((rs) =>
      rs.map((r) =>
        r.room_number === roomNumber ? { ...r, dnd: true, dnd_by: profile.id, dnd_at: new Date().toISOString() } : r,
      ),
    )

    const { error } = await supabase
      .from('rooms')
      .update({ dnd: true, dnd_by: profile.id, dnd_at: new Date().toISOString() })
      .eq('room_number', roomNumber)

    if (error) {
      setRooms(prev)
      setError(error.message)
    }
  }

  async function supervisorOverrideReleaseRequest(roomNumber: number) {
    if (!profile) return
    const current = rooms.find((r) => r.room_number === roomNumber) ?? null
    if (!current?.post_release_request) return
    if (profile.role !== 'supervisor') return
    if (current.inspected_by !== profile.id) return

    const ok = window.confirm(
      `This room still has an active ${postReleaseRequestLabel(
        current.post_release_request as PostReleaseRequest,
      )}. If Houseman/Public Area has not released it yet, clearing it will remove it from their Requests list.\n\nDo you want to release it anyway?`,
    )
    if (!ok) return

    setError(null)
    const prev = rooms
    setRooms((rs) =>
      rs.map((r) => (r.room_number === roomNumber ? { ...r, post_release_request: null } : r)),
    )

    const { error } = await supabase.from('rooms').update({ post_release_request: null }).eq('room_number', roomNumber)
    if (error) {
      setRooms(prev)
      setError(error.message)
    }
  }

  useEffect(() => {
    void loadRooms()
  }, [loadRooms])

  useEffect(() => {
    if (!profile) return
    if (profile.role === 'supervisor' && supervisorFilter === 'all') setSupervisorFilter('my')
  }, [profile, supervisorFilter])

  useEffect(() => {
    const channel = supabase
      .channel('rooms-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => void loadRooms())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loadRooms])

  if (!profile) {
    return (
      <AppShell title="Rooms">
        <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4 text-sm text-white/80">
          Your account is missing a profile. Ask a manager to assign your role.
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell title="Rooms">
      <div className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm text-white/60">Quick filter</div>
              <div className="truncate text-base font-semibold">Rooms board</div>
            </div>
            <button
              type="button"
              onClick={() => void loadRooms()}
              className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
            >
              Refresh
            </button>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setActiveStatus('all')}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-white/10 ${
                activeStatus === 'all' ? 'bg-white/10 text-white' : 'bg-white/5 text-white/80 hover:bg-white/10'
              }`}
            >
              All ({rooms.length})
            </button>
            {roomStatusOrder.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setActiveStatus(s)}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-white/10 ${
                  activeStatus === s ? 'bg-white/10 text-white' : 'bg-white/5 text-white/80 hover:bg-white/10'
                }`}
              >
                {statusLabel(s)} ({counts[s]})
              </button>
            ))}
            {profile.role === 'houseman' || profile.role === 'public_area' ? (
              <button
                type="button"
                onClick={() => setActiveStatus('requests')}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-white/10 ${
                  activeStatus === 'requests' ? 'bg-white/10 text-white' : 'bg-white/5 text-white/80 hover:bg-white/10'
                }`}
              >
                Requests ({requestCount})
              </button>
            ) : null}
            {profile.role === 'manager' || profile.role === 'supervisor' ? (
              <>
                <button
                  type="button"
                  onClick={() => setActiveStatus('stay')}
                  className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-white/10 ${
                    activeStatus === 'stay' ? 'bg-white/10 text-white' : 'bg-white/5 text-white/80 hover:bg-white/10'
                  }`}
                >
                  Stay ({stayCount})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveStatus('dnd')}
                  className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-white/10 ${
                    activeStatus === 'dnd' ? 'bg-white/10 text-white' : 'bg-white/5 text-white/80 hover:bg-white/10'
                  }`}
                >
                  DND ({dndCount})
                </button>
              </>
            ) : null}
          </div>

          <div className="mt-3">
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500/40">
              <Search className="h-4 w-4 text-white/60" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search room number"
                inputMode="numeric"
                className="w-full bg-transparent text-sm outline-none placeholder:text-white/40"
              />
            </div>
          </div>

          {profile.role === 'supervisor' ? (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="block">
                <div className="mb-1 text-xs font-medium text-white/70">Supervisor filter</div>
                <select
                  value={supervisorFilter}
                  onChange={(e) => {
                    const v = e.target.value as 'all' | 'my' | `sup:${string}`
                    setSupervisorFilter(v)
                    if (v !== 'my') setStaffFilterId('')
                  }}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500/40"
                >
                  <option value="my" className="bg-[#0B1220]">
                    My rooms
                  </option>
                  <option value="all" className="bg-[#0B1220]">
                    All rooms
                  </option>
                  {supervisorOptions
                    .filter((s) => s.id !== profile.id)
                    .map((s) => (
                      <option key={s.id} value={`sup:${s.id}`} className="bg-[#0B1220]">
                        {s.name}
                      </option>
                    ))}
                </select>
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-medium text-white/70">My staff</div>
                <select
                  value={staffFilterId}
                  disabled={supervisorFilter !== 'my'}
                  onChange={(e) => setStaffFilterId(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-40"
                >
                  <option value="" className="bg-[#0B1220]">
                    All
                  </option>
                  {myStaffOptions.map((s) => (
                    <option key={s.id} value={s.id} className="bg-[#0B1220]">
                      {s.name}
                      {s.role ? ` (${roleLabel(s.role)})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : profile.role === 'manager' ? (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="block">
                <div className="mb-1 text-xs font-medium text-white/70">Supervisor</div>
                <select
                  value={supervisorFilter}
                  onChange={(e) => setSupervisorFilter(e.target.value as 'all' | 'my' | `sup:${string}`)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500/40"
                >
                  <option value="all" className="bg-[#0B1220]">
                    All
                  </option>
                  {supervisorOptions.map((s) => (
                    <option key={s.id} value={`sup:${s.id}`} className="bg-[#0B1220]">
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <div className="mb-1 text-xs font-medium text-white/70">Assigned to</div>
                <select
                  value={staffFilterId}
                  onChange={(e) => setStaffFilterId(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500/40"
                >
                  <option value="" className="bg-[#0B1220]">
                    All
                  </option>
                  {staffOptions.supervisors.length ? (
                    <optgroup label="Supervisors">
                      {staffOptions.supervisors.map((s) => (
                        <option key={s.id} value={s.id} className="bg-[#0B1220]">
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {staffOptions.attendants.length ? (
                    <optgroup label="Room attendants">
                      {staffOptions.attendants.map((s) => (
                        <option key={s.id} value={s.id} className="bg-[#0B1220]">
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {staffOptions.housemen.length ? (
                    <optgroup label="Houseman">
                      {staffOptions.housemen.map((s) => (
                        <option key={s.id} value={s.id} className="bg-[#0B1220]">
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {staffOptions.publicArea.length ? (
                    <optgroup label="Public area">
                      {staffOptions.publicArea.map((s) => (
                        <option key={s.id} value={s.id} className="bg-[#0B1220]">
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {staffOptions.unknown.length ? (
                    <optgroup label="Other">
                      {staffOptions.unknown.map((s) => (
                        <option key={s.id} value={s.id} className="bg-[#0B1220]">
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </label>
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-20 rounded-2xl border border-white/10 bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : filteredRooms.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-6 text-center">
            <div className="text-sm text-white/70">No rooms match your filters.</div>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-[#111A2E] divide-y divide-white/10">
            {filteredRooms.map((room) => {
              const next = room.dnd
                ? []
                : allowedNextStatuses(profile.role, room.status, room.assigned_to === profile.id, room.task ?? null)
              const primary = next[0]
              const canQuick = Boolean(primary) && !(profile.role === 'supervisor' && primary === 'released' && room.inspected_by !== profile.id)
              const canDnd =
                !room.dnd &&
                room.status === 'dirty' &&
                room.assigned_to === profile.id &&
                room.task != null &&
                room.task !== 'checkout' &&
                (profile.role === 'attendant' ||
                  profile.role === 'ra' ||
                  profile.role === 'houseman' ||
                  profile.role === 'public_area' ||
                  (profile.role === 'supervisor' && room.assigned_to === profile.id))

              return (
                <div key={room.room_number} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 ring-1 ring-white/10">
                        {statusIcon(room.status)}
                      </div>
                      <div className="text-sm font-semibold leading-5">{formatRoomNumber(room.room_number)}</div>
                      <StatusPill status={room.status} task={room.task ?? null} />
                      {room.task ? (
                        <span
                          className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ring-1 ${
                            room.task === 'checkout'
                              ? 'bg-red-500/15 text-red-200 ring-red-400/20'
                              : 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/20'
                          }`}
                        >
                          {taskLabel(room.task)}
                        </span>
                      ) : null}
                      {room.dnd ? <span className="ml-2 text-[11px] font-semibold text-amber-200">DND</span> : null}
                      {room.post_release_request ? (
                        <span className="ml-2 text-[11px] text-white/60">
                          {postReleaseRequestLabel(room.post_release_request as PostReleaseRequest)}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-[11px] text-white/60">
                      {roomTypeLabel(roomType(room.room_number))} ·{' '}
                      {formatMinutes(
                        estimatedMinutesForRoomAndTask(room.room_number, (room.task ?? 'checkout') as RoomTask),
                      )}
                      m · {room.assigned_to ? 'Assigned' : 'Unassigned'}
                      {room.inspected_by ? ` · Supervisor: ${profileNames[room.inspected_by] ?? room.inspected_by}` : ''}
                      {room.released_by ? ` · Released by: ${profileNames[room.released_by] ?? room.released_by}` : ''}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 px-4 pb-3 sm:pb-3">
                    <Link
                      to={`/rooms/${room.room_number}`}
                      className="inline-flex items-center gap-1 rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
                    >
                      Details
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                    {profile.role === 'manager' &&
                    room.status === 'pending_inspection' &&
                    (room.task ?? 'checkout') === 'checkout' ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={releaseRequests[room.room_number] ?? ''}
                          onChange={(e) =>
                            setReleaseRequests((m) => ({
                              ...m,
                              [room.room_number]: e.target.value as PostReleaseRequest | '',
                            }))
                          }
                          className="min-w-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-blue-500/40"
                        >
                          <option value="" className="bg-[#0B1220]">
                            No request
                          </option>
                          <option value="houseman" className="bg-[#0B1220]">
                            Houseman
                          </option>
                          <option value="public_area" className="bg-[#0B1220]">
                            Public Area
                          </option>
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            const req = releaseRequests[room.room_number]
                              ? (releaseRequests[room.room_number] as PostReleaseRequest)
                              : null

                            if (req) {
                              const ok = window.confirm(
                                `You selected ${postReleaseRequestLabel(req)}.\n\nAfter releasing, this room will stay in their Requests list until they press Release on their side.\n\nDo you want to release the room now?`,
                              )
                              if (!ok) return
                            }

                            void releaseRoom(room.room_number, req)
                          }}
                          className="rounded-xl bg-blue-500 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-blue-500/20 hover:bg-blue-400"
                        >
                          Release
                        </button>
                      </div>
                    ) : profile.role === 'supervisor' &&
                      primary === 'released' &&
                      (room.task ?? 'checkout') === 'checkout' &&
                      room.inspected_by === profile.id ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={releaseRequests[room.room_number] ?? ''}
                          onChange={(e) =>
                            setReleaseRequests((m) => ({
                              ...m,
                              [room.room_number]: e.target.value as PostReleaseRequest | '',
                            }))
                          }
                          className="min-w-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-blue-500/40"
                        >
                          <option value="" className="bg-[#0B1220]">
                            No request
                          </option>
                          <option value="houseman" className="bg-[#0B1220]">
                            Houseman
                          </option>
                          <option value="public_area" className="bg-[#0B1220]">
                            Public Area
                          </option>
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            const req = releaseRequests[room.room_number]
                              ? (releaseRequests[room.room_number] as PostReleaseRequest)
                              : null

                            if (req) {
                              const ok = window.confirm(
                                `You selected ${postReleaseRequestLabel(req)}.\n\nAfter releasing, this room will stay in their Requests list until they press Release on their side.\n\nDo you want to release the room now?`,
                              )
                              if (!ok) return
                            }

                            void releaseRoom(room.room_number, req)
                          }}
                          className="rounded-xl bg-blue-500 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-blue-500/20 hover:bg-blue-400"
                        >
                          Release
                        </button>
                      </div>
                    ) : canQuick || canDnd ? (
                      <div className="flex items-center gap-2">
                        {canQuick ? (
                          <button
                            type="button"
                            onClick={() => void transition(room.room_number, primary)}
                            className="rounded-xl bg-blue-500 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-blue-500/20 hover:bg-blue-400"
                          >
                            {actionLabel(profile.role, primary)}
                          </button>
                        ) : null}
                        {canDnd ? (
                          <button
                            type="button"
                            onClick={() => void markDnd(room.room_number)}
                            className="rounded-xl bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-100 ring-1 ring-amber-400/20 hover:bg-amber-500/20"
                          >
                            DND
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {(profile.role === 'houseman' || profile.role === 'public_area') &&
                    room.status === 'released' &&
                    room.post_release_request === profile.role ? (
                      <button
                        type="button"
                        onClick={() => void clearPostReleaseRequest(room.room_number)}
                        className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
                      >
                        Release
                      </button>
                    ) : profile.role === 'supervisor' &&
                      room.status === 'released' &&
                      room.inspected_by === profile.id &&
                      (room.task ?? 'checkout') === 'checkout' ? (
                      room.post_release_request ? (
                        <button
                          type="button"
                          onClick={() => void supervisorOverrideReleaseRequest(room.room_number)}
                          className="rounded-xl bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-100 ring-1 ring-red-400/20 hover:bg-red-500/20"
                        >
                          Release
                        </button>
                      ) : null
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AppShell>
  )
}

