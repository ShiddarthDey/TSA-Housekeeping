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
  estimatedMinutesForRoomAndTask,
  formatMinutes,
  formatRoomNumber,
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

type ConfirmState =
  | null
  | {
      title: string
      message: string
      confirmText: string
      tone: 'primary' | 'danger'
      roomNumber: number
      action: { type: 'override_clear_request' }
    }

type RequestModalState =
  | null
  | {
      roomNumber: number
      target: PostReleaseRequest
      rush: boolean
      selected: Record<string, boolean>
      counts: Record<string, number>
      ozoneMinutes: number
      error: string | null
    }

const HOUSEMAN_OPTIONS: Array<{ key: string; label: string; counter?: boolean }> = [
  { key: 'carpet_wet', label: 'Carpet Wet' },
  { key: 'body_wash', label: 'Body wash', counter: true },
  { key: 'hand_wash', label: 'Hand wash' },
  { key: 'body_lotion', label: 'Body lotion' },
  { key: 'shampoo', label: 'Shampoo' },
  { key: 'condtionar', label: 'Condtionar' },
  { key: 'hand_towel', label: 'Hand towel' },
  { key: 'bathmat', label: 'Bathmat' },
  { key: 'bath_towels', label: 'Bath towels', counter: true },
  { key: 'face_towels', label: 'Face towels', counter: true },
  { key: 'toilet_tissue', label: 'Toilet tissue', counter: true },
  { key: 'facial_tissue', label: 'Facial tissue' },
  { key: 'laundry_docket', label: 'Laundry docket' },
  { key: 'laundry_bag', label: 'Laundry bag' },
  { key: 'laundry_docket_and_bag', label: 'Both laundry docket and bag' },
  { key: 'tea_cup', label: 'Tea cup', counter: true },
  { key: 'water_glass', label: 'Water glass', counter: true },
  { key: 'wine_glass', label: 'Wine glass', counter: true },
  { key: 'spoons', label: 'Spoons', counter: true },
  { key: 'hair_dryer', label: 'Hair dryer' },
  { key: 'iron', label: 'Iron' },
  { key: 'change_iron_board', label: 'Change iron board' },
  { key: 'fix_iron_board', label: 'Fix iron board' },
  { key: 'change_iron_board_cover', label: 'Change iron board cover' },
  { key: 'close_window', label: 'Close window' },
  { key: 'red_tea', label: 'Red tea', counter: true },
  { key: 'green_tea', label: 'Green tea', counter: true },
  { key: 'blue_tea', label: 'Blue tea', counter: true },
  { key: 'coffee', label: 'Coffee', counter: true },
  { key: 'decaf_coffee', label: 'Decaf coffee', counter: true },
  { key: 'brown_sugar', label: 'Brown sugar', counter: true },
  { key: 'sweetner', label: 'Sweetner', counter: true },
  { key: 'milk', label: 'Milk', counter: true },
  { key: 'change_kettle', label: 'Change kettle' },
  { key: 'keep_blanket', label: 'Keep blanket' },
  { key: 'take_extra_blanket', label: 'Take extra blanket' },
  { key: 'take_extra_doona', label: 'Take extra doona' },
  { key: 'change_topsheet', label: 'Change topsheet' },
  { key: 'change_pillowcover', label: 'Change pillowcover' },
  { key: 'make_twin', label: 'Make twin' },
  { key: 'make_king', label: 'Make king' },
]

const PUBLIC_AREA_OPTIONS: Array<{ key: string; label: string }> = [{ key: 'vacuum', label: 'Vacuum' }]

const REQUEST_LABELS: Record<string, string> = Object.fromEntries(
  [...HOUSEMAN_OPTIONS, ...PUBLIC_AREA_OPTIONS].map((o) => [o.key, o.label]),
) as Record<string, string>

export default function RoomsBoard() {
  const profile = useAuthStore((s) => s.profile)
  const [rooms, setRooms] = useState<Room[]>([])
  const [profileNames, setProfileNames] = useState<Record<string, string>>({})
  const [profileRoles, setProfileRoles] = useState<Record<string, Role>>({})
  const [releaseRequests, setReleaseRequests] = useState<Record<number, PostReleaseRequest | ''>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeStatus, setActiveStatus] = useState<RoomStatus | 'all' | 'requests' | 'stay' | 'dnd' | 'requested'>('all')
  const [search, setSearch] = useState('')
  const [supervisorFilter, setSupervisorFilter] = useState<'all' | 'my' | `sup:${string}`>('all')
  const [staffFilterId, setStaffFilterId] = useState<string>('')
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [requestModal, setRequestModal] = useState<RequestModalState>(null)

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

  const requestedCount = useMemo(() => {
    if (!profile) return 0
    if (profile.role !== 'manager' && profile.role !== 'supervisor') return 0
    return rooms.filter((r) => r.status === 'released' && r.post_release_request != null).length
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
        if (activeStatus === 'requested') return r.status === 'released' && r.post_release_request != null
        if (activeStatus === 'stay') return r.status === 'pending_inspection' && r.task != null && r.task !== 'checkout' && !r.dnd
        if (activeStatus === 'dnd') return Boolean(r.dnd)
        return r.status === activeStatus
      })
      .filter((r) => (s ? String(r.room_number).includes(s) : true))
      .sort((a, b) => {
        if (
          activeStatus === 'requests' &&
          (profile.role === 'houseman' || profile.role === 'public_area') &&
          Boolean(a.post_release_request_rush) !== Boolean(b.post_release_request_rush)
        ) {
          return Boolean(a.post_release_request_rush) ? -1 : 1
        }
        return a.room_number - b.room_number
      })
  }, [activeStatus, profile, rooms, search, staffFilterId, supervisorFilter])

  const loadRooms = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    setError(null)
    try {
      const { data, error } = await supabase
        .from('rooms')
        .select(
          'room_number, status, task, post_release_request, post_release_request_details, post_release_request_rush, post_release_request_claimed_by, post_release_request_claimed_at, dnd, dnd_by, dnd_at, assigned_to, inspected_by, released_by, released_at, updated_at, room_type, project_details',
        )
      if (error) throw error
      const nextRooms = (data ?? []) as Room[]
      setRooms(nextRooms)

      const ids = Array.from(
        new Set(
          nextRooms
            .flatMap((r) => [
              r.assigned_to,
              r.inspected_by,
              r.released_by,
              r.dnd_by,
              r.post_release_request_claimed_by,
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

  async function releaseRoom(
    roomNumber: number,
    request: PostReleaseRequest | null,
    requestDetails: unknown | null = null,
    requestRush: boolean = false,
  ) {
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
              post_release_request_details: request ? requestDetails : null,
              post_release_request_rush: request ? Boolean(requestRush) : false,
              post_release_request_claimed_by: null,
              post_release_request_claimed_at: null,
            }
          : r,
      ),
    )

    const patch: Partial<Room> = {
      status: 'released',
      released_by: releasedBy,
      released_at: new Date().toISOString(),
      post_release_request: request,
      post_release_request_details: request ? requestDetails : null,
      post_release_request_rush: request ? Boolean(requestRush) : false,
      post_release_request_claimed_by: null,
      post_release_request_claimed_at: null,
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
    if (!profile) return
    setError(null)
    const prev = rooms
    setRooms((rs) =>
      rs.map((r) =>
        r.room_number === roomNumber
          ? { ...r, post_release_request: null, post_release_request_details: null, post_release_request_rush: false }
          : r,
      ),
    )

    const { error } = await supabase.rpc('clear_post_release_request', { p_room_number: roomNumber })
    if (error) {
      setRooms(prev)
      setError(error.message)
    }
  }

  async function overrideClearPostReleaseRequest(roomNumber: number) {
    setError(null)
    const prev = rooms
    setRooms((rs) =>
      rs.map((r) =>
        r.room_number === roomNumber
          ? { ...r, post_release_request: null, post_release_request_details: null, post_release_request_rush: false }
          : r,
      ),
    )

    const { error } = await supabase
      .from('rooms')
      .update({ post_release_request: null, post_release_request_details: null, post_release_request_rush: false })
      .eq('room_number', roomNumber)
    if (error) {
      setRooms(prev)
      setError(error.message)
    }
  }

  async function claimPostReleaseRequest(roomNumber: number) {
    if (!profile) return
    if (profile.role !== 'houseman' && profile.role !== 'public_area') return

    setError(null)
    const current = rooms.find((r) => r.room_number === roomNumber) ?? null
    if (!current?.post_release_request) return
    if (current.status !== 'released') return
    if (current.post_release_request !== profile.role) return
    if (current.post_release_request_claimed_by) return

    const prev = rooms
    const claimedAt = new Date().toISOString()
    setRooms((rs) =>
      rs.map((r) =>
        r.room_number === roomNumber
          ? { ...r, post_release_request_claimed_by: profile.id, post_release_request_claimed_at: claimedAt }
          : r,
      ),
    )

    const { error } = await supabase.rpc('claim_post_release_request', { p_room_number: roomNumber })

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
    if (profile.role !== 'supervisor' && profile.role !== 'manager') return
    if (profile.role === 'supervisor' && current.inspected_by !== profile.id) return

    const requestedTo = current.post_release_request === 'houseman' ? 'Houseman' : 'Public Area'
    setConfirm({
      title: 'Confirm release',
      message: `Are you sure you want to release the room? ${requestedTo} may still not have completed the request.`,
      confirmText: 'Release',
      tone: 'danger',
      roomNumber,
      action: { type: 'override_clear_request' },
    })
  }

  type RequestToken = { key: string; label: string; count?: number; tone?: 'ozone' }

  function getRequestTokens(target: PostReleaseRequest, details: unknown | null | undefined): RequestToken[] {
    if (!details || typeof details !== 'object' || Array.isArray(details)) return []
    const d = details as Record<string, unknown>
    const itemsRaw = d.items
    const items =
      itemsRaw && typeof itemsRaw === 'object' && !Array.isArray(itemsRaw)
        ? (itemsRaw as Record<string, unknown>)
        : (d as Record<string, unknown>)

    const options = target === 'houseman' ? HOUSEMAN_OPTIONS : PUBLIC_AREA_OPTIONS
    const tokens: RequestToken[] = []
    for (const opt of options) {
      const v = items[opt.key]
      if (v === true) {
        tokens.push({ key: opt.key, label: opt.label })
        continue
      }
      const n = typeof v === 'number' ? Math.round(v) : typeof v === 'string' ? Math.round(Number(v)) : 0
      if (Number.isFinite(n) && n > 0) tokens.push({ key: opt.key, label: opt.label, count: n })
    }

    if (target === 'houseman') {
      const ozone =
        typeof d.ozone_minutes === 'number'
          ? Math.round(d.ozone_minutes)
          : typeof d.ozone_minutes === 'string'
            ? Math.round(Number(d.ozone_minutes))
            : 0
      if (Number.isFinite(ozone) && ozone > 0) tokens.push({ key: 'ozone_minutes', label: 'Ozone', count: ozone, tone: 'ozone' })
    }

    return tokens
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
        {confirm ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
            <div
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setConfirm(null)}
              role="presentation"
            />
            <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#111A2E] p-4 shadow-2xl shadow-black/40">
              <div className="text-sm font-semibold text-white">{confirm.title}</div>
              <div className="mt-2 text-sm text-white/70">{confirm.message}</div>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirm(null)}
                  className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const cur = confirm
                    setConfirm(null)
                    void overrideClearPostReleaseRequest(cur.roomNumber)
                  }}
                  className={`rounded-xl px-3 py-2 text-xs font-semibold text-white shadow-lg ${
                    confirm.tone === 'danger'
                      ? 'bg-red-500 shadow-red-500/20 hover:bg-red-400'
                      : 'bg-blue-500 shadow-blue-500/20 hover:bg-blue-400'
                  }`}
                >
                  {confirm.confirmText}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {requestModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
            <div
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => {
                const cur = requestModal
                setRequestModal(null)
                setReleaseRequests((m) => ({ ...m, [cur.roomNumber]: '' }))
              }}
              role="presentation"
            />
            <div className="relative w-full max-w-2xl rounded-2xl border border-white/10 bg-[#111A2E] shadow-2xl shadow-black/40">
              <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">
                    {requestModal.target === 'houseman' ? 'Houseman request' : 'Public Area request'} ·{' '}
                    {formatRoomNumber(requestModal.roomNumber)}
                  </div>
                  <div className="mt-1 text-xs text-white/60">Select what needs to be done for this room.</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const cur = requestModal
                    setRequestModal(null)
                    setReleaseRequests((m) => ({ ...m, [cur.roomNumber]: '' }))
                  }}
                  className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
                >
                  Close
                </button>
              </div>

              <div className="max-h-[70vh] overflow-y-auto p-4">
                <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={requestModal.rush}
                    onChange={(e) => setRequestModal((s) => (s ? { ...s, rush: e.target.checked } : s))}
                  />
                  <div className="text-sm font-semibold text-white">Rush room</div>
                  <div className="text-xs text-white/60">Sorts to the top of the request list.</div>
                </label>

                {requestModal.target === 'houseman' ? (
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {HOUSEMAN_OPTIONS.map((opt) =>
                      opt.counter ? (
                        <div
                          key={opt.key}
                          className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                        >
                          <div className="text-sm text-white">{opt.label}</div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setRequestModal((s) => {
                                  if (!s) return s
                                  const prev = s.counts[opt.key] ?? 0
                                  const next = Math.max(0, prev - 1)
                                  return { ...s, counts: { ...s.counts, [opt.key]: next } }
                                })
                              }
                              className="h-8 w-8 rounded-lg bg-white/5 text-sm font-semibold text-white/90 ring-1 ring-white/10 hover:bg-white/10"
                            >
                              -
                            </button>
                            <div className="w-8 text-center text-sm font-semibold text-white">
                              {requestModal.counts[opt.key] ?? 0}
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setRequestModal((s) => {
                                  if (!s) return s
                                  const prev = s.counts[opt.key] ?? 0
                                  const next = Math.min(99, prev + 1)
                                  return { ...s, counts: { ...s.counts, [opt.key]: next } }
                                })
                              }
                              className="h-8 w-8 rounded-lg bg-white/5 text-sm font-semibold text-white/90 ring-1 ring-white/10 hover:bg-white/10"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      ) : (
                        <label
                          key={opt.key}
                          className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(requestModal.selected[opt.key])}
                            onChange={(e) =>
                              setRequestModal((s) => {
                                if (!s) return s
                                return { ...s, selected: { ...s.selected, [opt.key]: e.target.checked } }
                              })
                            }
                          />
                          <div className="text-sm text-white">{opt.label}</div>
                        </label>
                      ),
                    )}

                    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 sm:col-span-2">
                      <div className="text-sm text-white">Keep ozone for</div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setRequestModal((s) => {
                              if (!s) return s
                              const next = Math.max(0, s.ozoneMinutes - 1)
                              return { ...s, ozoneMinutes: next }
                            })
                          }
                          className="h-8 w-8 rounded-lg bg-white/5 text-sm font-semibold text-white/90 ring-1 ring-white/10 hover:bg-white/10"
                        >
                          -
                        </button>
                        <div className="w-10 text-center text-sm font-semibold text-white">{requestModal.ozoneMinutes}</div>
                        <button
                          type="button"
                          onClick={() =>
                            setRequestModal((s) => {
                              if (!s) return s
                              const next = Math.min(240, s.ozoneMinutes + 1)
                              return { ...s, ozoneMinutes: next }
                            })
                          }
                          className="h-8 w-8 rounded-lg bg-white/5 text-sm font-semibold text-white/90 ring-1 ring-white/10 hover:bg-white/10"
                        >
                          +
                        </button>
                        <div className="text-sm text-white/70">minute(s)</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 grid grid-cols-1 gap-2">
                    {PUBLIC_AREA_OPTIONS.map((opt) => (
                      <label
                        key={opt.key}
                        className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(requestModal.selected[opt.key])}
                          onChange={(e) =>
                            setRequestModal((s) => {
                              if (!s) return s
                              return { ...s, selected: { ...s.selected, [opt.key]: e.target.checked } }
                            })
                          }
                        />
                        <div className="text-sm text-white">{opt.label}</div>
                      </label>
                    ))}
                  </div>
                )}

                {requestModal.error ? (
                  <div className="mt-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    {requestModal.error}
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-white/10 p-4">
                <button
                  type="button"
                  onClick={() => {
                    const cur = requestModal
                    setRequestModal(null)
                    setReleaseRequests((m) => ({ ...m, [cur.roomNumber]: '' }))
                  }}
                  className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const cur = requestModal
                    if (!cur) return

                    const items: Record<string, number | boolean> = {}
                    for (const opt of cur.target === 'houseman' ? HOUSEMAN_OPTIONS : PUBLIC_AREA_OPTIONS) {
                      if ((opt as { counter?: boolean }).counter) {
                        const n = Math.max(0, Math.round(cur.counts[opt.key] ?? 0))
                        if (n > 0) items[opt.key] = n
                      } else if (cur.selected[opt.key]) {
                        items[opt.key] = true
                      }
                    }
                    const ozoneMinutes = Math.max(0, Math.round(cur.ozoneMinutes || 0))
                    const hasAny =
                      Object.keys(items).length > 0 || (cur.target === 'houseman' ? ozoneMinutes > 0 : false)

                    if (!hasAny) {
                      setRequestModal((s) => (s ? { ...s, error: 'Select at least one request item.' } : s))
                      return
                    }

                    const details: Record<string, unknown> = { items }
                    if (cur.target === 'houseman' && ozoneMinutes > 0) details.ozone_minutes = ozoneMinutes

                    setRequestModal(null)
                    void releaseRoom(cur.roomNumber, cur.target, details, cur.rush)
                  }}
                  className="rounded-xl bg-blue-500 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-blue-500/20 hover:bg-blue-400"
                >
                  Request
                </button>
              </div>
            </div>
          </div>
        ) : null}

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
                  onClick={() => setActiveStatus('requested')}
                  className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-white/10 ${
                    activeStatus === 'requested' ? 'bg-white/10 text-white' : 'bg-white/5 text-white/80 hover:bg-white/10'
                  }`}
                >
                  Requested ({requestedCount})
                </button>
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
                <div key={room.room_number} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:px-4 sm:py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 ring-1 ring-white/10">
                        {statusIcon(room.status)}
                      </div>
                      <div className="text-sm font-semibold leading-5">{formatRoomNumber(room.room_number)}</div>
                      <StatusPill
                        status={room.status}
                        task={room.task ?? null}
                        postReleaseRequest={room.post_release_request ?? null}
                      />
                      {room.task ? (
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
                            room.task === 'checkout'
                              ? 'bg-red-500/15 text-red-200 ring-red-400/20'
                              : 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/20'
                          }`}
                        >
                          {taskLabel(room.task)}
                        </span>
                      ) : null}
                      {room.room_type ? (
                        <span className="inline-flex items-center rounded-full bg-blue-500/15 px-2.5 py-1 text-xs font-medium text-blue-200 ring-1 ring-blue-400/20">
                          {room.room_type === 'king' ? 'King' : 'Twin'}
                        </span>
                      ) : null}
                      {room.project_details && Array.isArray(room.project_details) && room.project_details.length > 0 ? (
                        <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-200 ring-1 ring-amber-400/20">
                          Project
                        </span>
                      ) : null}
                      {room.dnd ? <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-200 ring-1 ring-amber-400/20">DND</span> : null}
                      {(profile.role === 'houseman' || profile.role === 'public_area') &&
                      activeStatus === 'requests' &&
                      room.post_release_request_rush ? (
                        <span className="inline-flex items-center rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-medium text-red-100 ring-1 ring-red-400/20">
                          RUSH
                        </span>
                      ) : null}
                      {(profile.role === 'houseman' || profile.role === 'public_area') &&
                      activeStatus === 'requests' &&
                      room.post_release_request_claimed_by === profile.id ? (
                        <span className="inline-flex items-center rounded-full bg-white/5 px-2.5 py-1 text-xs font-medium text-white/80 ring-1 ring-white/10">
                          Claimed
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 text-[11px] text-white/60">
                      {roomTypeLabel(roomType(room.room_number))} ·{' '}
                      {formatMinutes(
                        estimatedMinutesForRoomAndTask(room.room_number, (room.task ?? 'checkout') as RoomTask),
                      )}
                      m · {room.assigned_to ? `Assigned to: ${profileNames[room.assigned_to] ?? 'Unknown'}` : 'Unassigned'}
                      {room.inspected_by ? ` · Supervisor: ${profileNames[room.inspected_by] ?? room.inspected_by}` : ''}
                      {room.released_by ? ` · Released by: ${profileNames[room.released_by] ?? room.released_by}` : ''}
                    </div>
                    {(profile.role === 'houseman' || profile.role === 'public_area') &&
                    activeStatus === 'requests' &&
                    room.post_release_request_details ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {getRequestTokens(profile.role as PostReleaseRequest, room.post_release_request_details).map((t) => (
                          <span
                            key={t.key}
                            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
                              t.tone === 'ozone'
                                ? 'bg-amber-500/15 text-amber-200 ring-amber-400/20'
                                : 'bg-white/5 text-white/80 ring-white/10'
                            }`}
                          >
                            {t.label}
                            {typeof t.count === 'number' && t.count > 0 ? (t.key === 'ozone_minutes' ? `: ${t.count} min` : ` x${t.count}`) : ''}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mt-3 sm:mt-0">
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
                          onChange={(e) => {
                            const v = e.target.value as PostReleaseRequest | ''
                            setReleaseRequests((m) => ({ ...m, [room.room_number]: v }))
                            if (v === 'houseman' || v === 'public_area') {
                              setRequestModal({
                                roomNumber: room.room_number,
                                target: v,
                                rush: false,
                                selected: {},
                                counts: {},
                                ozoneMinutes: 0,
                                error: null,
                              })
                            }
                          }}
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
                          disabled={Boolean(releaseRequests[room.room_number])}
                          onClick={() => void releaseRoom(room.room_number, null)}
                          className="rounded-xl bg-blue-500 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-blue-500/20 hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
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
                          onChange={(e) => {
                            const v = e.target.value as PostReleaseRequest | ''
                            setReleaseRequests((m) => ({ ...m, [room.room_number]: v }))
                            if (v === 'houseman' || v === 'public_area') {
                              setRequestModal({
                                roomNumber: room.room_number,
                                target: v,
                                rush: false,
                                selected: {},
                                counts: {},
                                ozoneMinutes: 0,
                                error: null,
                              })
                            }
                          }}
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
                          disabled={Boolean(releaseRequests[room.room_number])}
                          onClick={() => void releaseRoom(room.room_number, null)}
                          className="rounded-xl bg-blue-500 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-blue-500/20 hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
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
                      room.post_release_request_claimed_by ? (
                        room.post_release_request_claimed_by === profile.id ? (
                          <button
                            type="button"
                            onClick={() => void clearPostReleaseRequest(room.room_number)}
                            className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
                          >
                            Release
                          </button>
                        ) : null
                      ) : (
                        <button
                          type="button"
                          onClick={() => void claimPostReleaseRequest(room.room_number)}
                          className="rounded-xl bg-blue-500 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-blue-500/20 hover:bg-blue-400"
                        >
                          Claim
                        </button>
                      )
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
                    {profile.role === 'manager' &&
                    room.status === 'released' &&
                    room.post_release_request &&
                    (room.task ?? 'checkout') === 'checkout' ? (
                      <button
                        type="button"
                        onClick={() => void supervisorOverrideReleaseRequest(room.room_number)}
                        className="rounded-xl bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-100 ring-1 ring-red-400/20 hover:bg-red-500/20"
                      >
                        Release
                      </button>
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

