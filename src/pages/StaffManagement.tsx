import { CheckCircle2, Grid3X3, Shield, TriangleAlert, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import AppShell from '@/components/AppShell'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import type { Room, RoomStatus, RoomTask, Role } from '@/utils/domain'
import {
  estimatedMinutesForRoomAndTask,
  formatMinutes,
  formatMinutesAsHours,
  formatRoomNumber,
  roleLabel,
  roomType,
  roomTypeLabel,
  shiftCapacityLabel,
  shiftCapacityMinutes,
  taskLabel,
} from '@/utils/domain'

type StaffRow = {
  id: string
  name: string | null
  role: Role
  email: string | null
  is_active?: boolean | null
}

type TaskChoice = RoomTask

type AssignSelection = Record<number, TaskChoice>

type EndSessionStep = 'idle' | 'exporting' | 'deleting' | 'done'

type AnyRow = Record<string, unknown>

function generateRoomNumbers(): string[] {
  const out: string[] = []
  for (let i = 1; i <= 5; i += 1) out.push(`M${i}`)
  for (let floor = 1; floor <= 6; floor += 1) {
    for (let room = 1; room <= 34; room += 1) {
      out.push(`${floor}${String(room).padStart(2, '0')}`)
    }
  }
  return out
}

function parseRoomNumber(room: string): number | null {
  if (room.startsWith('M')) {
    const n = Number(room.slice(1))
    return Number.isFinite(n) ? 9000 + n : null
  }
  const n = Number(room)
  return Number.isFinite(n) ? n : null
}

function displayRoomNumber(n: number): string {
  if (n >= 9001 && n <= 9005) return `M${n - 9000}`
  return String(n)
}

function taskOptions(): TaskChoice[] {
  return ['checkout', 'stay', 'vip_stay', 'linen_change', 'full_service']
}

export default function StaffManagement() {
  const profile = useAuthStore((s) => s.profile)

  const [staff, setStaff] = useState<StaffRow[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [activeStaff, setActiveStaff] = useState<StaffRow | null>(null)
  const [selection, setSelection] = useState<AssignSelection>({})
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [inspectorId, setInspectorId] = useState<string>('')

  const [endOpen, setEndOpen] = useState(false)
  const [endConfirmText, setEndConfirmText] = useState('')
  const [endStep, setEndStep] = useState<EndSessionStep>('idle')
  const [endError, setEndError] = useState<string | null>(null)
  const [endSuccess, setEndSuccess] = useState<string | null>(null)

  const canAccess = profile?.role === 'manager' || profile?.role === 'supervisor'

  const [staffFilter, setStaffFilter] = useState<'all' | 'supervisors' | 'room_attendants' | 'houseman' | 'public_area'>('all')

  const allRoomNumbers = useMemo(() => generateRoomNumbers().map(parseRoomNumber).filter((n): n is number => n != null), [])

  const roomsByNumber = useMemo(() => {
    const map = new Map<number, Room>()
    for (const r of rooms) map.set(r.room_number, r)
    return map
  }, [rooms])

  const nameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of staff) map.set(s.id, s.name ?? s.email ?? s.id)
    return map
  }, [staff])

  const supervisorOptions = useMemo(
    () => staff.filter((s) => s.role === 'supervisor' && s.is_active !== false),
    [staff],
  )

  const activeStaffList = useMemo(() => staff.filter((s) => s.role !== 'manager' && s.is_active !== false), [staff])

  const staffCounts = useMemo(() => {
    const counts = {
      supervisors: 0,
      room_attendants: 0,
      houseman: 0,
      public_area: 0,
      total: 0,
    }
    for (const s of activeStaffList) {
      counts.total += 1
      if (s.role === 'supervisor') counts.supervisors += 1
      if (s.role === 'houseman') counts.houseman += 1
      if (s.role === 'public_area') counts.public_area += 1
      if (s.role === 'attendant' || s.role === 'ra') counts.room_attendants += 1
    }
    return counts
  }, [activeStaffList])

  const filteredStaff = useMemo(() => {
    if (staffFilter === 'all') return activeStaffList
    if (staffFilter === 'supervisors') return activeStaffList.filter((s) => s.role === 'supervisor')
    if (staffFilter === 'houseman') return activeStaffList.filter((s) => s.role === 'houseman')
    if (staffFilter === 'public_area') return activeStaffList.filter((s) => s.role === 'public_area')
    return activeStaffList.filter((s) => s.role === 'attendant' || s.role === 'ra')
  }, [activeStaffList, staffFilter])

  const assignedCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of rooms) {
      if (!r.assigned_to) continue
      counts.set(r.assigned_to, (counts.get(r.assigned_to) ?? 0) + 1)
    }
    return counts
  }, [rooms])

  const assignedMinutes = useMemo(() => {
    const mins = new Map<string, number>()
    for (const r of rooms) {
      if (!r.assigned_to) continue
      mins.set(
        r.assigned_to,
        (mins.get(r.assigned_to) ?? 0) + estimatedMinutesForRoomAndTask(r.room_number, (r.task ?? 'checkout') as RoomTask),
      )
    }
    return mins
  }, [rooms])

  const selectedMinutes = useMemo(() => {
    return Object.keys(selection)
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n))
      .reduce((sum, n) => sum + estimatedMinutesForRoomAndTask(n, selection[n]), 0)
  }, [selection])

  const activeShiftCapacity = useMemo(() => {
    if (!activeStaff) return null
    return shiftCapacityMinutes(activeStaff.role)
  }, [activeStaff])

  const activeOverCapacity = useMemo(() => {
    if (!activeShiftCapacity) return false
    return selectedMinutes > activeShiftCapacity
  }, [activeShiftCapacity, selectedMinutes])

  function csvEscape(v: unknown): string {
    if (v == null) return ''
    const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? String(v) : JSON.stringify(v)
    const needs = s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')
    const escaped = s.replace(/"/g, '""')
    return needs ? `"${escaped}"` : escaped
  }

  async function fetchAll(table: string): Promise<AnyRow[]> {
    const out: AnyRow[] = []
    const pageSize = 1000
    let from = 0
    while (true) {
      const { data, error } = await supabase.from(table).select('*').range(from, from + pageSize - 1)
      if (error) throw error
      const chunk = ((data ?? []) as unknown) as AnyRow[]
      out.push(...chunk)
      if (chunk.length < pageSize) break
      from += pageSize
    }
    return out
  }

  function downloadCsv(filename: string, content: string) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function endWorkSession() {
    if (!profile) return
    if (profile.role !== 'manager' && profile.role !== 'supervisor') return
    if (endConfirmText.trim().toUpperCase() !== 'END') return

    setEndError(null)
    setEndSuccess(null)
    setEndStep('exporting')

    try {
      const exportedAt = new Date()
      const [profilesRows, roomsRows, workRows] = await Promise.all([
        fetchAll('profiles'),
        fetchAll('rooms'),
        fetchAll('room_work'),
      ])

      const lines: string[] = []

      const stamp = exportedAt.toISOString()

      const exportRows: Array<AnyRow & { table: string; exported_at: string }> = []
      for (const r of profilesRows) exportRows.push({ table: 'profiles', exported_at: stamp, ...r })
      for (const r of roomsRows) exportRows.push({ table: 'rooms', exported_at: stamp, ...r })
      for (const r of workRows) exportRows.push({ table: 'room_work', exported_at: stamp, ...r })

      const columnSet = new Set<string>()
      for (const r of exportRows) for (const k of Object.keys(r)) columnSet.add(k)
      const columns = ['table', 'exported_at', ...Array.from(columnSet).filter((c) => c !== 'table' && c !== 'exported_at').sort()]

      lines.push(columns.join(','))
      for (const r of exportRows) lines.push(columns.map((c) => csvEscape(r[c])).join(','))

      downloadCsv(`housekeeping_export_${stamp.replace(/[:.]/g, '-')}.csv`, lines.join('\n'))

      setEndStep('deleting')

      const { error: workDeleteError } = await supabase
        .from('room_work')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000')
      if (workDeleteError) throw workDeleteError

      const { error: roomsDeleteError } = await supabase.from('rooms').delete().gt('room_number', -1)
      if (roomsDeleteError) throw roomsDeleteError

      setEndStep('done')
      setEndSuccess('Work session ended. Rooms data cleared.')
      setEndConfirmText('')
      setEndOpen(false)
      await loadAll()
    } catch (e) {
      setEndStep('idle')
      setEndError(e instanceof Error ? e.message : 'Failed to end work session')
    }
  }

  const loadAll = useCallback(async () => {
    if (!canAccess) return
    setLoading(true)
    setError(null)
    try {
      const [{ data: staffData, error: staffError }, { data: roomData, error: roomError }] = await Promise.all([
        supabase.from('profiles').select('id, name, role, email, is_active'),
        supabase.from('rooms').select('room_number, status, task, assigned_to, inspected_by, released_by, released_at, updated_at'),
      ])

      if (staffError) throw staffError
      if (roomError) throw roomError

      setStaff((staffData ?? []) as StaffRow[])
      setRooms((roomData ?? []) as Room[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load staff')
    } finally {
      setLoading(false)
    }
  }, [canAccess])

  function openAssignModal(s: StaffRow) {
    setSuccess(null)
    setError(null)
    setActiveStaff(s)
    setInspectorId((prev) => {
      if (prev) return prev
      if (profile?.role === 'supervisor') return profile.id
      return supervisorOptions[0]?.id ?? ''
    })

    const next: AssignSelection = {}
    for (const r of rooms) {
      if (r.assigned_to === s.id) {
        next[r.room_number] = (r.task ?? 'checkout') as TaskChoice
      }
    }
    setSelection(next)
  }

  function closeAssignModal() {
    setActiveStaff(null)
    setSelection({})
    setSaving(false)
  }

  function toggleRoom(roomNumber: number) {
    if (!activeStaff) return
    const current = roomsByNumber.get(roomNumber)
    if (current?.assigned_to && current.assigned_to !== activeStaff.id) return

    setSelection((prev) => {
      const copy = { ...prev }
      if (copy[roomNumber]) {
        delete copy[roomNumber]
      } else {
        copy[roomNumber] = 'checkout'
      }
      return copy
    })
  }

  function setRoomTask(roomNumber: number, task: TaskChoice) {
    setSelection((prev) => ({ ...prev, [roomNumber]: task }))
  }

  async function removeStaffMember(s: StaffRow) {
    if (!profile) return
    if (s.id === profile.id) return
    if (s.role === 'manager') return
    if (profile.role === 'supervisor' && s.role === 'supervisor') return
    if (profile.role !== 'manager' && profile.role !== 'supervisor') return

    const ok = window.confirm(
      `Remove ${s.name ?? s.email ?? s.id}?\n\nThis will disable their account and unassign any rooms currently assigned to them.`,
    )
    if (!ok) return

    setNotice(null)
    setError(null)
    try {
      const { error: unassignError } = await supabase.from('rooms').update({ assigned_to: null }).eq('assigned_to', s.id)
      if (unassignError) throw unassignError

      if (s.role === 'supervisor') {
        const { error: clearInspectorError } = await supabase.from('rooms').update({ inspected_by: null }).eq('inspected_by', s.id)
        if (clearInspectorError) throw clearInspectorError
      }

      const { error: deactivateError } = await supabase.from('profiles').update({ is_active: false }).eq('id', s.id)
      if (deactivateError) throw deactivateError

      setNotice('Staff member removed.')
      await loadAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove staff member')
    }
  }

  async function assignRooms() {
    if (!activeStaff) return
    const selectedNumbers = Object.keys(selection).map((k) => Number(k)).filter((n) => Number.isFinite(n))
    if (selectedNumbers.length === 0) return
    if (!inspectorId) {
      setError('Select a supervisor to check these rooms.')
      return
    }
    const capacity = shiftCapacityMinutes(activeStaff.role)
    if (capacity != null && selectedMinutes > capacity) {
      setError(`This assignment exceeds the ${shiftCapacityLabel(activeStaff.role) ?? 'shift'} capacity.`)
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const { data: existing, error: existingError } = await supabase
        .from('rooms')
        .select('room_number, status')
        .in('room_number', selectedNumbers)

      if (existingError) throw existingError

      const statusByRoom = new Map<number, RoomStatus>()
      for (const r of (existing ?? []) as Array<{ room_number: number; status: RoomStatus }>) statusByRoom.set(r.room_number, r.status)

      const payload = selectedNumbers.map((n) => ({
        room_number: n,
        status: statusByRoom.get(n) ?? 'dirty',
        task: selection[n],
        assigned_to: activeStaff.id,
        inspected_by: inspectorId,
      }))

      const { error: upsertError } = await supabase.from('rooms').upsert(payload, { onConflict: 'room_number' })
      if (upsertError) throw upsertError

      setSuccess('Assigned successfully.')
      await loadAll()
      openAssignModal(activeStaff)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to assign rooms')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  useEffect(() => {
    if (!canAccess) return
    const channel = supabase
      .channel('staff-management-rooms')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => void loadAll())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [canAccess, loadAll])

  if (!canAccess) {
    return (
      <AppShell title="Staff Management">
        <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4 text-sm text-white/80">
          This page is only available to Managers and Supervisors.
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell
      title="Staff Management"
      actions={
        <button
          type="button"
          onClick={() => {
            setEndError(null)
            setEndSuccess(null)
            setEndStep('idle')
            setEndConfirmText('')
            setEndOpen(true)
          }}
          className="rounded-xl bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-100 ring-1 ring-red-400/20 hover:bg-red-500/20"
        >
          End today&apos;s work session
        </button>
      }
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Users className="h-4 w-4 text-white/80" />
                Staff list
              </div>
              <div className="mt-1 text-xs text-white/60">Tap a staff member to assign rooms.</div>
            </div>

            <div className="flex items-center gap-2">
              <Link
                to="/staff/create"
                className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
              >
                Add user
              </Link>
            </div>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setStaffFilter('all')}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-white/10 ${
                staffFilter === 'all' ? 'bg-white/10 text-white' : 'bg-white/5 text-white/80 hover:bg-white/10'
              }`}
            >
              All ({staffCounts.total})
            </button>
            <button
              type="button"
              onClick={() => setStaffFilter('supervisors')}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-white/10 ${
                staffFilter === 'supervisors' ? 'bg-white/10 text-white' : 'bg-white/5 text-white/80 hover:bg-white/10'
              }`}
            >
              Supervisors ({staffCounts.supervisors})
            </button>
            <button
              type="button"
              onClick={() => setStaffFilter('room_attendants')}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-white/10 ${
                staffFilter === 'room_attendants' ? 'bg-white/10 text-white' : 'bg-white/5 text-white/80 hover:bg-white/10'
              }`}
            >
              Room Attendants ({staffCounts.room_attendants})
            </button>
            <button
              type="button"
              onClick={() => setStaffFilter('houseman')}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-white/10 ${
                staffFilter === 'houseman' ? 'bg-white/10 text-white' : 'bg-white/5 text-white/80 hover:bg-white/10'
              }`}
            >
              Houseman ({staffCounts.houseman})
            </button>
            <button
              type="button"
              onClick={() => setStaffFilter('public_area')}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-white/10 ${
                staffFilter === 'public_area' ? 'bg-white/10 text-white' : 'bg-white/5 text-white/80 hover:bg-white/10'
              }`}
            >
              Public Area ({staffCounts.public_area})
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
        ) : null}

        {notice ? (
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {notice}
          </div>
        ) : null}

        {endSuccess ? (
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {endSuccess}
          </div>
        ) : null}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-20 rounded-2xl border border-white/10 bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {filteredStaff
              .map((s) => (
                <div
                  key={s.id}
                  onClick={() => openAssignModal(s)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      openAssignModal(s)
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  className="rounded-2xl border border-white/10 bg-[#111A2E] p-4 text-left hover:bg-white/5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white">{s.name ?? s.email ?? 'Unnamed'}</div>
                      <div className="mt-1 text-xs text-white/60">{roleLabel(s.role)}</div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {(() => {
                          const canRemove =
                            Boolean(profile) &&
                            (profile.role === 'manager' || profile.role === 'supervisor') &&
                            s.role !== 'manager' &&
                            s.id !== profile.id &&
                            !(profile.role === 'supervisor' && s.role === 'supervisor')
                          return canRemove ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                void removeStaffMember(s)
                              }}
                              className="rounded-xl bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-100 ring-1 ring-red-400/20 hover:bg-red-500/20"
                            >
                              Remove
                            </button>
                          ) : null
                        })()}
                      </div>
                      <div className="mt-2 text-xs text-white/60">Assigned</div>
                      <div className="text-2xl font-semibold leading-6">{assignedCounts.get(s.id) ?? 0}</div>
                      <div className="mt-1 text-xs text-white/60">{formatMinutes(assignedMinutes.get(s.id) ?? 0)} mins</div>
                      {shiftCapacityMinutes(s.role) != null ? (
                        <div className="mt-1 text-[11px] text-white/50">
                          {shiftCapacityLabel(s.role)} · {formatMinutesAsHours(shiftCapacityMinutes(s.role) ?? 0)}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <Link
                      to={`/productivity/${s.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
                    >
                      Productivity
                    </Link>
                    <div className="text-xs text-white/50">View stats</div>
                  </div>
                </div>
              ))}
          </div>
        )}

        {profile?.role === 'supervisor' ? (
          <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4">
            <div className="text-sm font-semibold">My inspections</div>
            <div className="mt-1 text-xs text-white/60">Rooms assigned to you to check.</div>
            <div className="mt-3 space-y-2">
              {rooms
                .filter((r) => r.inspected_by === profile.id && r.assigned_to)
                .sort((a, b) => a.room_number - b.room_number)
                .slice(0, 30)
                .map((r) => (
                  <div key={r.room_number} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold">Room {formatRoomNumber(r.room_number)}</div>
                      <div className="text-xs text-white/60">{r.task ? taskLabel(r.task) : ''}</div>
                    </div>
                    <div className="mt-1 text-xs text-white/70">
                      RA: {r.assigned_to ? (nameById.get(r.assigned_to) ?? r.assigned_to) : '—'}
                    </div>
                  </div>
                ))}
              {rooms.filter((r) => r.inspected_by === profile.id && r.assigned_to).length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70">
                  No rooms assigned to you yet.
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4">
          <div className="text-sm font-semibold">Release activity</div>
          <div className="mt-1 text-xs text-white/60">Who released which rooms.</div>
          <div className="mt-3 space-y-2">
            {rooms
              .filter((r) => r.status === 'released')
              .sort((a, b) => {
                const at = a.released_at ? Date.parse(a.released_at) : 0
                const bt = b.released_at ? Date.parse(b.released_at) : 0
                return bt - at
              })
              .slice(0, 50)
              .map((r) => (
                <div key={r.room_number} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold">Room {formatRoomNumber(r.room_number)}</div>
                    <div className="text-xs text-white/60">{r.task ? taskLabel(r.task) : ''}</div>
                  </div>
                  <div className="mt-1 text-xs text-white/70">
                    {(() => {
                      const by = r.inspected_by ?? r.released_by ?? null
                      const byLabel = 'Released by'
                      return (
                        <>
                          RA: {r.assigned_to ? (nameById.get(r.assigned_to) ?? r.assigned_to) : '—'} · {byLabel}:{' '}
                          {by ? nameById.get(by) ?? by : 'Unknown'}
                        </>
                      )
                    })()}
                  </div>
                </div>
              ))}
            {rooms.filter((r) => r.status === 'released').length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70">
                No released rooms yet.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {activeStaff ? (
        <div className="fixed inset-0 z-50 bg-black/70 p-4">
          <div className="mx-auto flex h-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0B1220] shadow-2xl shadow-black/40">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#111A2E] px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Grid3X3 className="h-4 w-4 text-white/80" />
                  Assign rooms
                </div>
                <div className="mt-0.5 truncate text-xs text-white/60">
                  {activeStaff.name ?? activeStaff.email ?? activeStaff.id} · {roleLabel(activeStaff.role)}
                </div>
              </div>

              <button
                type="button"
                onClick={closeAssignModal}
                className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4">
              {success ? (
                <div className="mb-3 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="h-4 w-4" />
                    {success}
                  </div>
                </div>
              ) : null}

              <div className="mb-3 rounded-2xl border border-white/10 bg-[#111A2E] p-3">
                <div className="text-xs font-medium text-white/70">Supervisor checking these rooms</div>
                <select
                  value={inspectorId}
                  onChange={(e) => setInspectorId(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500/40"
                >
                  <option value="" className="bg-[#0B1220]">
                    Select supervisor…
                  </option>
                  {supervisorOptions.map((s) => (
                    <option key={s.id} value={s.id} className="bg-[#0B1220]">
                      {s.name ?? s.email ?? s.id}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-5 gap-2 sm:grid-cols-8">
                {allRoomNumbers.map((n) => {
                  const r = roomsByNumber.get(n)
                  const assignedTo = r?.assigned_to ?? null
                  const isLocked = Boolean(assignedTo && assignedTo !== activeStaff.id)
                  const isSelected = Boolean(selection[n])
                  const selectedTask = selection[n]
                  const currentTask = r?.task ?? null

                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => toggleRoom(n)}
                      disabled={isLocked}
                      className={`rounded-xl border px-2 py-2 text-left text-xs ring-1 transition ${
                        isLocked
                          ? 'border-white/10 bg-white/5 text-white/40 ring-white/10'
                          : isSelected
                            ? 'border-emerald-400/30 bg-emerald-500/10 text-white ring-emerald-400/20'
                            : 'border-white/10 bg-[#111A2E] text-white/90 ring-white/10 hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-semibold">{displayRoomNumber(n)}</div>
                        {isLocked ? <Shield className="h-3.5 w-3.5 text-white/40" /> : null}
                      </div>

                      {isLocked ? (
                        <div className="mt-1 truncate text-[10px] text-white/40">Assigned</div>
                      ) : isSelected ? (
                        <div className="mt-1">
                          <div className="mb-1 truncate text-[10px] text-white/60">
                            {roomTypeLabel(roomType(n))} · {formatMinutes(estimatedMinutesForRoomAndTask(n, selectedTask))}m
                          </div>
                          <select
                            value={selectedTask}
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onChange={(e) => setRoomTask(n, e.target.value as TaskChoice)}
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-white outline-none"
                          >
                            {taskOptions().map((t) => (
                              <option key={t} value={t} className="bg-[#0B1220]">
                                {taskLabel(t)}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : currentTask ? (
                        <div className="mt-1 truncate text-[10px] text-white/60">{taskLabel(currentTask)}</div>
                      ) : (
                        <div className="mt-1 truncate text-[10px] text-white/60">Unassigned</div>
                      )}

                      {assignedTo && assignedTo !== activeStaff.id ? (
                        <div className="mt-1 truncate text-[10px] text-white/40">{nameById.get(assignedTo) ?? 'Assigned'}</div>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="border-t border-white/10 bg-[#111A2E] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-white/60">
                  Selected: <span className="font-semibold text-white/80">{Object.keys(selection).length}</span> ·{' '}
                  <span className="font-semibold text-white/80">{formatMinutes(selectedMinutes)} mins</span>
                  {activeShiftCapacity != null ? (
                    <>
                      {' '}
                      · Capacity: <span className="font-semibold text-white/80">{formatMinutes(activeShiftCapacity)} mins</span>
                    </>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={saving || Object.keys(selection).length === 0 || activeOverCapacity}
                  onClick={() => void assignRooms()}
                  className="rounded-xl bg-blue-500 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-blue-500/20 hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {saving ? 'Assigning…' : 'Assign'}
                </button>
              </div>
              {activeOverCapacity ? (
                <div className="mt-2 text-[11px] text-red-200">Over shift capacity. Reduce selected rooms or change tasks.</div>
              ) : null}
              {profile?.role === 'supervisor' ? (
                <div className="mt-2 text-[11px] text-white/50">
                  Supervisors can assign staff rooms, but can only release room statuses after inspection.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {endOpen ? (
        <div className="fixed inset-0 z-50 bg-black/70 p-4">
          <div className="mx-auto max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-[#0B1220] shadow-2xl shadow-black/40">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#111A2E] px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <TriangleAlert className="h-4 w-4 text-red-200" />
                End today&apos;s work session
              </div>
              <button
                type="button"
                onClick={() => setEndOpen(false)}
                className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
              >
                Close
              </button>
            </div>

            <div className="p-4">
              <div className="text-sm text-white/80">
                This will export a CSV backup, then delete all rows from <span className="font-semibold text-white/90">rooms</span> and{' '}
                <span className="font-semibold text-white/90">room_work</span>. Profiles will not be deleted.
              </div>

              {endError ? (
                <div className="mt-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {endError}
                </div>
              ) : null}

              <div className="mt-4">
                <div className="text-xs font-medium text-white/70">Type END to confirm</div>
                <input
                  value={endConfirmText}
                  onChange={(e) => setEndConfirmText(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-red-500/30"
                  placeholder="END"
                />
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="text-xs text-white/60">
                  {endStep === 'exporting' ? 'Exporting…' : endStep === 'deleting' ? 'Deleting…' : null}
                </div>
                <button
                  type="button"
                  disabled={endStep !== 'idle' || endConfirmText.trim().toUpperCase() !== 'END'}
                  onClick={() => void endWorkSession()}
                  className="rounded-xl bg-red-500 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-red-500/20 hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  End session
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  )
}
