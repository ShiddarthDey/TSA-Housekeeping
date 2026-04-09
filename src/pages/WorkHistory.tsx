import { CalendarDays, Clock, Download, FileText, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import AppShell from '@/components/AppShell'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import type { PostReleaseRequest, Room, RoomTask } from '@/utils/domain'
import { formatMinutesAsHours, formatRoomNumber, taskLabel } from '@/utils/domain'

type WorkDayRow = {
  work_date: string
  archived_at: string
  timezone: string
  rooms_count: number
  room_work_count: number
}

type HistoryRoom = {
  work_date: string
  room_number: number
  status: Room['status']
  task: RoomTask | null
  post_release_request: PostReleaseRequest | null
  dnd: boolean
  dnd_by: string | null
  dnd_at: string | null
  assigned_to: string | null
  inspected_by: string | null
  released_by: string | null
  released_at: string | null
  updated_at: string | null
}

type HistoryWork = {
  work_date: string
  id: string
  room_number: number
  staff_id: string
  task: RoomTask
  started_at: string
  done_at: string | null
  expected_minutes: number
}

function minutesBetweenIso(a: string, b: string): number {
  const ms = Date.parse(b) - Date.parse(a)
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.round(ms / 60000)
}

function csvEscape(v: unknown): string {
  if (v == null) return ''
  const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? String(v) : JSON.stringify(v)
  const needs = s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')
  const escaped = s.replace(/"/g, '""')
  return needs ? `"${escaped}"` : escaped
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

export default function WorkHistory() {
  const profile = useAuthStore((s) => s.profile)
  const canAccess = profile?.role === 'manager' || profile?.role === 'supervisor'

  const [days, setDays] = useState<WorkDayRow[]>([])
  const [selectedDay, setSelectedDay] = useState<WorkDayRow | null>(null)

  const [rooms, setRooms] = useState<HistoryRoom[]>([])
  const [work, setWork] = useState<HistoryWork[]>([])
  const [names, setNames] = useState<Record<string, string>>({})

  const [loadingDays, setLoadingDays] = useState(true)
  const [loadingDay, setLoadingDay] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDays = useCallback(async () => {
    if (!canAccess) return
    setLoadingDays(true)
    setError(null)
    try {
      const { data, error } = await supabase
        .from('work_days')
        .select('work_date, archived_at, timezone, rooms_count, room_work_count')
        .order('work_date', { ascending: false })
        .limit(90)
      if (error) throw error
      const next = (data ?? []) as WorkDayRow[]
      setDays(next)
      setSelectedDay((prev) => prev ?? next[0] ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load work history')
    } finally {
      setLoadingDays(false)
    }
  }, [canAccess])

  const loadDay = useCallback(
    async (workDate: string) => {
      if (!canAccess) return
      setLoadingDay(true)
      setError(null)
      try {
        const [{ data: roomsData, error: roomsError }, { data: workData, error: workError }] = await Promise.all([
          supabase
            .from('work_history_rooms')
            .select(
              'work_date, room_number, status, task, post_release_request, dnd, dnd_by, dnd_at, assigned_to, inspected_by, released_by, released_at, updated_at',
            )
            .eq('work_date', workDate),
          supabase
            .from('work_history_room_work')
            .select('work_date, id, room_number, staff_id, task, started_at, done_at, expected_minutes')
            .eq('work_date', workDate),
        ])

        if (roomsError) throw roomsError
        if (workError) throw workError

        const nextRooms = (roomsData ?? []) as HistoryRoom[]
        const nextWork = (workData ?? []) as HistoryWork[]
        setRooms(nextRooms)
        setWork(nextWork)

        const ids = Array.from(
          new Set(
            nextRooms
              .flatMap((r) => [r.assigned_to, r.inspected_by, r.released_by, r.dnd_by])
              .concat(nextWork.map((w) => w.staff_id))
              .filter((v): v is string => typeof v === 'string' && v.length > 0),
          ),
        )

        if (ids.length > 0) {
          const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('id, name, email')
            .in('id', ids)
          if (!profilesError) {
            const map: Record<string, string> = {}
            for (const p of (profiles ?? []) as Array<{ id: string; name: string | null; email: string | null }>) {
              map[p.id] = p.name ?? p.email ?? p.id
            }
            setNames(map)
          }
        } else {
          setNames({})
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load day')
        setRooms([])
        setWork([])
        setNames({})
      } finally {
        setLoadingDay(false)
      }
    },
    [canAccess],
  )

  useEffect(() => {
    void loadDays()
  }, [loadDays])

  useEffect(() => {
    if (!selectedDay) return
    void loadDay(selectedDay.work_date)
  }, [loadDay, selectedDay])

  const byStaff = useMemo(() => {
    const map = new Map<
      string,
      {
        staffId: string
        roomsStarted: number
        roomsDone: number
        expectedMinutes: number
        actualMinutes: number
      }
    >()

    for (const w of work) {
      const cur =
        map.get(w.staff_id) ??
        ({
          staffId: w.staff_id,
          roomsStarted: 0,
          roomsDone: 0,
          expectedMinutes: 0,
          actualMinutes: 0,
        } as const)

      const next = {
        staffId: cur.staffId,
        roomsStarted: cur.roomsStarted + 1,
        roomsDone: cur.roomsDone + (w.done_at ? 1 : 0),
        expectedMinutes: cur.expectedMinutes + Math.round(Number(w.expected_minutes) || 0),
        actualMinutes: cur.actualMinutes + (w.done_at ? minutesBetweenIso(w.started_at, w.done_at) : 0),
      }
      map.set(w.staff_id, next)
    }

    return Array.from(map.values()).sort((a, b) => b.actualMinutes - a.actualMinutes)
  }, [work])

  const totals = useMemo(() => {
    const expectedMinutes = byStaff.reduce((s, r) => s + r.expectedMinutes, 0)
    const actualMinutes = byStaff.reduce((s, r) => s + r.actualMinutes, 0)
    const roomsDone = byStaff.reduce((s, r) => s + r.roomsDone, 0)
    return { expectedMinutes, actualMinutes, roomsDone }
  }, [byStaff])

  const releasedRooms = useMemo(
    () => rooms.filter((r) => r.status === 'released' && (r.task ?? 'checkout') === 'checkout'),
    [rooms],
  )

  const cleanedStayRooms = useMemo(
    () => rooms.filter((r) => r.status === 'pending_inspection' && r.task != null && r.task !== 'checkout' && !r.dnd),
    [rooms],
  )

  const cleanedStayByTask = useMemo(() => {
    const map: Record<string, number> = {}
    for (const r of cleanedStayRooms) map[r.task ?? 'unknown'] = (map[r.task ?? 'unknown'] ?? 0) + 1
    return map
  }, [cleanedStayRooms])

  const dndRooms = useMemo(() => rooms.filter((r) => r.dnd), [rooms])

  const exportSelectedDayCsv = useCallback(() => {
    if (!selectedDay) return
    const stamp = new Date().toISOString()

    const exportRows: Array<Record<string, unknown>> = []

    exportRows.push({
      table: 'work_day',
      exported_at: stamp,
      work_date: selectedDay.work_date,
      archived_at: selectedDay.archived_at,
      timezone: selectedDay.timezone,
      rooms_count: selectedDay.rooms_count,
      room_work_count: selectedDay.room_work_count,
      workers: byStaff.length,
      total_actual_minutes: totals.actualMinutes,
      total_expected_minutes: totals.expectedMinutes,
      rooms_done: totals.roomsDone,
      released_checkout_rooms: releasedRooms.length,
      dnd_rooms: dndRooms.length,
    })

    for (const r of rooms) {
      exportRows.push({
        table: 'work_history_rooms',
        exported_at: stamp,
        work_date: r.work_date,
        room_number: r.room_number,
        status: r.status,
        task: r.task,
        post_release_request: r.post_release_request,
        dnd: r.dnd,
        dnd_by: r.dnd_by,
        dnd_by_name: r.dnd_by ? names[r.dnd_by] ?? r.dnd_by : null,
        dnd_at: r.dnd_at,
        assigned_to: r.assigned_to,
        assigned_to_name: r.assigned_to ? names[r.assigned_to] ?? r.assigned_to : null,
        inspected_by: r.inspected_by,
        inspected_by_name: r.inspected_by ? names[r.inspected_by] ?? r.inspected_by : null,
        released_by: r.released_by,
        released_by_name: r.released_by ? names[r.released_by] ?? r.released_by : null,
        released_at: r.released_at,
        updated_at: r.updated_at,
      })
    }

    for (const w of work) {
      exportRows.push({
        table: 'work_history_room_work',
        exported_at: stamp,
        work_date: w.work_date,
        id: w.id,
        room_number: w.room_number,
        staff_id: w.staff_id,
        staff_name: names[w.staff_id] ?? w.staff_id,
        task: w.task,
        started_at: w.started_at,
        done_at: w.done_at,
        expected_minutes: w.expected_minutes,
        actual_minutes: w.done_at ? minutesBetweenIso(w.started_at, w.done_at) : 0,
      })
    }

    for (const s of byStaff) {
      exportRows.push({
        table: 'staff_totals',
        exported_at: stamp,
        work_date: selectedDay.work_date,
        staff_id: s.staffId,
        staff_name: names[s.staffId] ?? s.staffId,
        rooms_started: s.roomsStarted,
        rooms_done: s.roomsDone,
        expected_minutes: s.expectedMinutes,
        actual_minutes: s.actualMinutes,
      })
    }

    const columnSet = new Set<string>()
    for (const r of exportRows) for (const k of Object.keys(r)) columnSet.add(k)
    const columns = Array.from(columnSet).sort()

    const lines: string[] = []
    lines.push(columns.join(','))
    for (const r of exportRows) lines.push(columns.map((c) => csvEscape(r[c])).join(','))

    downloadCsv(`work_history_${selectedDay.work_date}_${stamp.replace(/[:.]/g, '-')}.csv`, lines.join('\n'))
  }, [byStaff, dndRooms.length, names, releasedRooms.length, rooms, selectedDay, totals, work])

  if (!canAccess) {
    return (
      <AppShell title="Work history">
        <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4 text-sm text-white/80">
          This page is only available to Managers and Supervisors.
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell title="Work history">
      <div className="space-y-4">
        {error ? (
          <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
        ) : null}

        <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <CalendarDays className="h-4 w-4 text-white/80" />
                Dates
              </div>
              <div className="mt-1 text-xs text-white/60">Tap a date to view a summary.</div>
            </div>
            <button
              type="button"
              disabled={!selectedDay || loadingDay}
              onClick={exportSelectedDayCsv}
              className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download className="h-4 w-4" />
              Download CSV
            </button>
          </div>

          {loadingDays ? (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 rounded-xl border border-white/10 bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : days.length === 0 ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70">
              No archived days yet.
            </div>
          ) : (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {days.map((d) => (
                <button
                  key={d.work_date}
                  type="button"
                  onClick={() => setSelectedDay(d)}
                  className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-white/10 ${
                    selectedDay?.work_date === d.work_date ? 'bg-white/10 text-white' : 'bg-white/5 text-white/80 hover:bg-white/10'
                  }`}
                >
                  {d.work_date}
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedDay ? (
          <>
            <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <FileText className="h-4 w-4 text-white/80" />
                    Summary · {selectedDay.work_date}
                  </div>
                  <div className="mt-1 text-xs text-white/60">
                    Archived at {new Date(selectedDay.archived_at).toLocaleString()} ({selectedDay.timezone})
                  </div>
                </div>
              </div>

              {loadingDay ? (
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-20 rounded-2xl border border-white/10 bg-white/5 animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="flex items-center gap-2 text-xs text-white/70">
                      <Users className="h-4 w-4 text-white/70" />
                      Workers
                    </div>
                    <div className="mt-2 text-2xl font-semibold leading-6">{byStaff.length}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="flex items-center gap-2 text-xs text-white/70">
                      <Clock className="h-4 w-4 text-white/70" />
                      Total time
                    </div>
                    <div className="mt-2 text-2xl font-semibold leading-6">{formatMinutesAsHours(totals.actualMinutes)}</div>
                    <div className="mt-1 text-[11px] text-white/50">Expected: {formatMinutesAsHours(totals.expectedMinutes)}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="text-xs text-white/70">Released (Checkout)</div>
                    <div className="mt-2 text-2xl font-semibold leading-6">{releasedRooms.length}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="text-xs text-white/70">DND</div>
                    <div className="mt-2 text-2xl font-semibold leading-6">{dndRooms.length}</div>
                  </div>
                </div>
              )}
            </div>

            {!loadingDay ? (
              <>
                <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4">
                  <div className="text-sm font-semibold">Stay / VIP / Linen / Full Service (Room Cleaned)</div>
                  <div className="mt-1 text-xs text-white/60">Only rooms that were cleaned (not DND).</div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(['stay', 'vip_stay', 'linen_change', 'full_service'] as RoomTask[]).map((t) => (
                      <div key={t} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
                        <div className="text-xs text-white/60">{taskLabel(t)}</div>
                        <div className="mt-1 text-xl font-semibold">{cleanedStayByTask[t] ?? 0}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4">
                  <div className="text-sm font-semibold">Staff totals</div>
                  <div className="mt-1 text-xs text-white/60">Hours are based on Start Room → Room Done timestamps.</div>
                  <div className="mt-3 space-y-2">
                    {byStaff.map((s) => (
                      <div key={s.staffId} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-semibold">{names[s.staffId] ?? s.staffId}</div>
                          <div className="text-xs text-white/70">{formatMinutesAsHours(s.actualMinutes)}</div>
                        </div>
                        <div className="mt-1 text-xs text-white/60">
                          Rooms done: {s.roomsDone} · Expected: {formatMinutesAsHours(s.expectedMinutes)}
                        </div>
                      </div>
                    ))}
                    {byStaff.length === 0 ? (
                      <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70">
                        No room work recorded for this day.
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4">
                  <div className="text-sm font-semibold">Released rooms</div>
                  <div className="mt-1 text-xs text-white/60">Checkout rooms only.</div>
                  <div className="mt-3 space-y-2">
                    {releasedRooms
                      .slice()
                      .sort((a, b) => (Date.parse(b.released_at ?? '') || 0) - (Date.parse(a.released_at ?? '') || 0))
                      .slice(0, 60)
                      .map((r) => (
                        <div key={r.room_number} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-semibold">Room {formatRoomNumber(r.room_number)}</div>
                            <div className="text-xs text-white/70">{r.released_at ? new Date(r.released_at).toLocaleTimeString() : ''}</div>
                          </div>
                          <div className="mt-1 text-xs text-white/60">
                            RA: {r.assigned_to ? names[r.assigned_to] ?? r.assigned_to : '—'} · Supervisor:{' '}
                            {r.inspected_by ? names[r.inspected_by] ?? r.inspected_by : '—'} · Released by:{' '}
                            {r.released_by ? names[r.released_by] ?? r.released_by : '—'}
                          </div>
                        </div>
                      ))}
                    {releasedRooms.length === 0 ? (
                      <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70">
                        No released rooms for this day.
                      </div>
                    ) : null}
                  </div>
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </AppShell>
  )
}
