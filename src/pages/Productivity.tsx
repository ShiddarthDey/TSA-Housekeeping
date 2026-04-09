import { BarChart3, Clock, Timer, User } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import AppShell from '@/components/AppShell'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import type { Room, RoomTask, RoomWork } from '@/utils/domain'
import {
  estimatedMinutesForRoomAndTask,
  formatAud,
  formatMinutes,
  formatMinutesAsHours,
  formatRoomNumber,
  normalizeRole,
  payRateAud,
  shiftCapacityLabel,
  shiftCapacityMinutes,
  taskLabel,
} from '@/utils/domain'

type ProfileRow = {
  id: string
  name: string | null
  role: string
  email: string | null
}

function minutesBetween(startedAt: string, doneAt: string | null): number | null {
  if (!doneAt) return null
  const s = Date.parse(startedAt)
  const e = Date.parse(doneAt)
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null
  const mins = (e - s) / 60000
  return mins >= 0 ? mins : null
}

function startOfDayNDaysAgoISO(daysAgo: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString()
}

type RangeKey = 'today' | '7d' | '14d'

function localDayKey(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function labelDay(key: string): string {
  const [y, m, d] = key.split('-').map((v) => Number(v))
  if (!y || !m || !d) return key
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-AU', { weekday: 'short', month: 'short', day: 'numeric' })
}

function dateFromDayKey(key: string): Date | null {
  const [y, m, d] = key.split('-').map((v) => Number(v))
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export default function Productivity() {
  const { staffId } = useParams()
  const viewer = useAuthStore((s) => s.profile)

  const [range, setRange] = useState<RangeKey>('14d')
  const [staffProfile, setStaffProfile] = useState<ProfileRow | null>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [work, setWork] = useState<RoomWork[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const canViewAny = viewer?.role === 'manager' || viewer?.role === 'supervisor'
  const targetStaffId = staffId ?? viewer?.id ?? null
  const viewingOther = Boolean(staffId && staffId !== viewer?.id)

  const rangeDays = useMemo(() => {
    if (range === 'today') return 1
    if (range === '7d') return 7
    return 14
  }, [range])

  const completed = useMemo(() => work.filter((w) => w.done_at), [work])

  const completedWithDurations = useMemo(() => {
    return completed
      .map((w) => ({
        ...w,
        actual_minutes: minutesBetween(w.started_at, w.done_at),
      }))
      .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at))
  }, [completed])

  const completedInRange = useMemo(() => completedWithDurations, [completedWithDurations])

  const totalActual = useMemo(() => {
    return completedInRange.reduce((sum, w) => sum + (w.actual_minutes ?? 0), 0)
  }, [completedInRange])

  const totalExpected = useMemo(() => {
    return completedInRange.reduce((sum, w) => sum + (Number(w.expected_minutes) || 0), 0)
  }, [completedInRange])

  const remainingAssigned = useMemo(() => {
    if (!targetStaffId) return []
    return rooms.filter((r) => r.assigned_to === targetStaffId && r.status !== 'pending_inspection' && r.status !== 'released')
  }, [rooms, targetStaffId])

  const allAssigned = useMemo(() => {
    if (!targetStaffId) return []
    return rooms.filter((r) => r.assigned_to === targetStaffId)
  }, [rooms, targetStaffId])

  const staffRole = useMemo(() => normalizeRole(staffProfile?.role), [staffProfile?.role])

  const shiftCapacity = useMemo(() => (staffRole ? shiftCapacityMinutes(staffRole) : null), [staffRole])
  const fixedShiftHours = useMemo(() => {
    if (!staffRole) return 0
    const mins = shiftCapacityMinutes(staffRole)
    if (mins == null) return 0
    return mins / 60
  }, [staffRole])

  const assignedExpected = useMemo(() => {
    return allAssigned.reduce((sum, r) => sum + estimatedMinutesForRoomAndTask(r.room_number, (r.task ?? 'checkout') as RoomTask), 0)
  }, [allAssigned])

  const remainingCapacity = useMemo(() => {
    if (shiftCapacity == null) return null
    return Math.max(0, shiftCapacity - assignedExpected)
  }, [assignedExpected, shiftCapacity])

  const todayRate = useMemo(() => payRateAud(new Date()), [])

  const paidMinutesToday = useMemo(() => {
    return completedInRange.reduce((sum, w) => sum + (Number(w.expected_minutes) || 0), 0)
  }, [completedInRange])

  const roomPaidHoursToday = useMemo(() => paidMinutesToday / 60, [paidMinutesToday])

  const totalPaidHoursToday = useMemo(() => {
    if (staffRole === 'houseman' || staffRole === 'public_area') return fixedShiftHours + roomPaidHoursToday
    return roomPaidHoursToday
  }, [fixedShiftHours, roomPaidHoursToday, staffRole])

  const earningsToday = useMemo(() => {
    return totalPaidHoursToday * todayRate
  }, [todayRate, totalPaidHoursToday])

  const dailySeries = useMemo(() => {
    const map = new Map<
      string,
      { key: string; rooms: number; actual: number; expected: number }
    >()

    for (const w of completedWithDurations) {
      const key = localDayKey(w.done_at ?? w.started_at)
      const entry = map.get(key) ?? { key, rooms: 0, actual: 0, expected: 0 }
      entry.rooms += 1
      entry.actual += w.actual_minutes ?? 0
      entry.expected += Number(w.expected_minutes) || 0
      map.set(key, entry)
    }

    const keys = Array.from(map.keys()).sort((a, b) => a.localeCompare(b))
    const last14 = keys.slice(-14)
    return last14
      .map((k) => {
        const base = map.get(k)
        if (!base) return null
        const date = dateFromDayKey(k)
        const rate = date ? payRateAud(date) : 25.8
        const fixedHours = staffRole === 'houseman' || staffRole === 'public_area' ? fixedShiftHours : 0
        const paidHours = base.rooms > 0 ? base.expected / 60 + fixedHours : 0
        return { ...base, earnings: paidHours * rate }
      })
      .filter(Boolean) as Array<{ key: string; rooms: number; actual: number; expected: number; earnings: number }>
  }, [completedWithDurations, fixedShiftHours, staffRole])

  const maxDailyEarnings = useMemo(() => Math.max(1, ...dailySeries.map((d) => d.earnings)), [dailySeries])
  const maxDailyMinutes = useMemo(() => Math.max(1, ...dailySeries.map((d) => d.actual)), [dailySeries])
  const maxDailyHours = useMemo(() => {
    const values = dailySeries.flatMap((d) => [d.actual / 60, d.expected / 60])
    return Math.max(1, ...values)
  }, [dailySeries])

  useEffect(() => {
    async function load() {
      if (!viewer) return
      if (!targetStaffId) return
      if (viewingOther && !canViewAny) {
        setError('Only Managers and Supervisors can view other staff productivity.')
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)
      try {
        const since = startOfDayNDaysAgoISO(rangeDays - 1)

        const workQuery = supabase
          .from('room_work')
          .select('id, room_number, staff_id, task, started_at, done_at, expected_minutes, created_at')
          .eq('staff_id', targetStaffId)
          .gte('started_at', since)
          .order('started_at', { ascending: true })

        const [{ data: profileData, error: profileError }, { data: roomData, error: roomError }, { data: workData, error: workError }] =
          await Promise.all([
            supabase.from('profiles').select('id, name, role, email').eq('id', targetStaffId).maybeSingle(),
            supabase.from('rooms').select('room_number, status, task, assigned_to, updated_at').eq('assigned_to', targetStaffId),
            workQuery,
          ])

        if (profileError) throw profileError
        if (roomError) throw roomError
        if (workError) throw workError

        setStaffProfile((profileData ?? null) as ProfileRow | null)
        setRooms((roomData ?? []) as Room[])
        setWork((workData ?? []) as RoomWork[])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load productivity')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [canViewAny, rangeDays, targetStaffId, viewer, viewingOther])

  const maxBar = useMemo(() => {
    const values = completedWithDurations.map((w) => Math.max(Number(w.expected_minutes) || 0, w.actual_minutes ?? 0))
    return Math.max(1, ...values)
  }, [completedWithDurations])

  return (
    <AppShell title="Productivity">
      <div className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">
                {staffProfile?.name ?? staffProfile?.email ?? (viewingOther ? 'Staff' : 'My')} productivity
              </div>
              <div className="mt-1 text-xs text-white/60">
                {range === 'today' ? 'Today' : range === '7d' ? 'Last 7 days' : 'Last 14 days'}
              </div>
            </div>
            {canViewAny ? (
              <Link
                to="/staff"
                className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/90 ring-1 ring-white/10 hover:bg-white/10"
              >
                Staff
              </Link>
            ) : null}
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setRange('today')}
            className={`rounded-xl px-3 py-2 text-xs font-medium ring-1 ${
              range === 'today' ? 'bg-white/10 text-white ring-white/20' : 'bg-white/5 text-white/80 ring-white/10 hover:bg-white/10'
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setRange('7d')}
            className={`rounded-xl px-3 py-2 text-xs font-medium ring-1 ${
              range === '7d' ? 'bg-white/10 text-white ring-white/20' : 'bg-white/5 text-white/80 ring-white/10 hover:bg-white/10'
            }`}
          >
            7 days
          </button>
          <button
            type="button"
            onClick={() => setRange('14d')}
            className={`rounded-xl px-3 py-2 text-xs font-medium ring-1 ${
              range === '14d' ? 'bg-white/10 text-white ring-white/20' : 'bg-white/5 text-white/80 ring-white/10 hover:bg-white/10'
            }`}
          >
            14 days
          </button>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
        ) : null}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-20 rounded-2xl border border-white/10 bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {remainingAssigned.length === 0 && allAssigned.length > 0 ? (
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                All assigned rooms completed.
              </div>
            ) : allAssigned.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4 text-sm text-white/80">
                No rooms currently assigned.
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4 text-sm text-white/80">
                Remaining rooms: <span className="font-semibold text-white/90">{remainingAssigned.length}</span>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <User className="h-4 w-4 text-white/80" />
                  Rooms done
                </div>
                <div className="mt-2 text-3xl font-semibold leading-7">{completedInRange.length}</div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Timer className="h-4 w-4 text-white/80" />
                  Total time worked
                </div>
                <div className="mt-2 text-3xl font-semibold leading-7">{formatMinutes(totalActual)} mins</div>
                <div className="mt-1 text-xs text-white/60">{formatMinutesAsHours(totalActual)}</div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Clock className="h-4 w-4 text-white/80" />
                  Expected time
                </div>
                <div className="mt-2 text-3xl font-semibold leading-7">{formatMinutes(totalExpected)} mins</div>
                <div className="mt-1 text-xs text-white/60">{formatMinutesAsHours(totalExpected)}</div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <BarChart3 className="h-4 w-4 text-white/80" />
                  Time difference
                </div>
                <div className="mt-2 text-3xl font-semibold leading-7">{formatMinutes(totalActual - totalExpected)} mins</div>
                <div className="mt-1 text-xs text-white/60">
                  {totalActual - totalExpected <= 0 ? 'Finished before expected time' : 'Finished after expected time'}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4">
                <div className="text-sm font-semibold">Earnings (today)</div>
                <div className="mt-1 text-xs text-white/60">Weekday $25.80/hr · Sat $32/hr · Sun $38/hr</div>
                <div className="mt-2 text-3xl font-semibold leading-7">{formatAud(earningsToday)}</div>
                <div className="mt-1 text-xs text-white/60">Current rate: {formatAud(todayRate)}/hr</div>
                {(staffRole === 'houseman' || staffRole === 'public_area') && fixedShiftHours > 0 ? (
                  <>
                    <div className="mt-1 text-xs text-white/60">Fixed shift: {formatMinutes(fixedShiftHours)}h</div>
                    <div className="mt-1 text-xs text-white/60">Room hours: {formatMinutes(roomPaidHoursToday)}h</div>
                  </>
                ) : null}
              </div>

              {shiftCapacity != null ? (
                <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold">Shift capacity</div>
                    <div className="text-xs text-white/60">{staffRole ? shiftCapacityLabel(staffRole) : ''}</div>
                  </div>
                  <div className="mt-2 text-3xl font-semibold leading-7">{formatMinutes(shiftCapacity)} mins</div>
                  <div className="mt-1 text-xs text-white/60">{formatMinutesAsHours(shiftCapacity)}</div>
                </div>
              ) : null}

              {shiftCapacity != null ? (
                <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4">
                  <div className="text-sm font-semibold">Assigned load (expected)</div>
                  <div className="mt-2 text-3xl font-semibold leading-7">{formatMinutes(assignedExpected)} mins</div>
                  <div className="mt-1 text-xs text-white/60">
                    Remaining: {formatMinutes(remainingCapacity ?? 0)} mins ({formatMinutesAsHours(remainingCapacity ?? 0)})
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4">
              <div className="text-sm font-semibold">Last 14 work days</div>
              <div className="mt-1 text-xs text-white/60">Earnings + time trend across days.</div>

              <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-white">Daily working hours</div>
                  <div className="text-xs text-white/60">Actual vs Paid</div>
                </div>
                {dailySeries.length === 0 ? (
                  <div className="mt-3 text-sm text-white/70">No history yet.</div>
                ) : (
                  <div className="mt-3">
                    {(() => {
                      const w = 320
                      const h = 160
                      const padL = 34
                      const padR = 12
                      const padT = 10
                      const padB = 34
                      const innerW = w - padL - padR
                      const innerH = h - padT - padB
                      const n = dailySeries.length
                      const xStep = n > 1 ? innerW / (n - 1) : 0
                      const maxH = maxDailyHours * 1.1
                      const yForHours = (hours: number) => padT + (1 - clamp(hours / maxH, 0, 1)) * innerH
                      const xForIndex = (i: number) => padL + i * xStep

                      const actualPts = dailySeries.map((d, i) => `${xForIndex(i)},${yForHours(d.actual / 60)}`).join(' ')
                      const paidPts = dailySeries.map((d, i) => `${xForIndex(i)},${yForHours(d.expected / 60)}`).join(' ')

                      const yTicks = [0, round1(maxH / 2), round1(maxH)]
                      const lastLabel = labelDay(dailySeries[n - 1].key)
                      const midLabel = n >= 3 ? labelDay(dailySeries[Math.floor((n - 1) / 2)].key) : ''
                      const firstLabel = labelDay(dailySeries[0].key)

                      return (
                        <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
                          <line x1={padL} y1={padT} x2={padL} y2={padT + innerH} stroke="rgba(255,255,255,0.12)" />
                          <line
                            x1={padL}
                            y1={padT + innerH}
                            x2={padL + innerW}
                            y2={padT + innerH}
                            stroke="rgba(255,255,255,0.12)"
                          />

                          {yTicks.map((t) => (
                            <g key={t}>
                              <line
                                x1={padL}
                                y1={yForHours(t)}
                                x2={padL + innerW}
                                y2={yForHours(t)}
                                stroke="rgba(255,255,255,0.06)"
                              />
                              <text
                                x={padL - 6}
                                y={yForHours(t) + 4}
                                fill="rgba(255,255,255,0.55)"
                                fontSize="10"
                                textAnchor="end"
                              >
                                {t}h
                              </text>
                            </g>
                          ))}

                          <polyline points={paidPts} fill="none" stroke="rgba(59,130,246,0.9)" strokeWidth="2" />
                          <polyline points={actualPts} fill="none" stroke="rgba(16,185,129,0.9)" strokeWidth="2" />

                          {dailySeries.map((d, i) => (
                            <g key={d.key}>
                              <circle cx={xForIndex(i)} cy={yForHours(d.expected / 60)} r="2.2" fill="rgba(59,130,246,0.95)" />
                              <circle cx={xForIndex(i)} cy={yForHours(d.actual / 60)} r="2.2" fill="rgba(16,185,129,0.95)" />
                            </g>
                          ))}

                          <text
                            x={padL}
                            y={padT + innerH + 22}
                            fill="rgba(255,255,255,0.55)"
                            fontSize="10"
                            textAnchor="start"
                          >
                            {firstLabel}
                          </text>
                          {midLabel ? (
                            <text
                              x={padL + innerW / 2}
                              y={padT + innerH + 22}
                              fill="rgba(255,255,255,0.55)"
                              fontSize="10"
                              textAnchor="middle"
                            >
                              {midLabel}
                            </text>
                          ) : null}
                          <text
                            x={padL + innerW}
                            y={padT + innerH + 22}
                            fill="rgba(255,255,255,0.55)"
                            fontSize="10"
                            textAnchor="end"
                          >
                            {lastLabel}
                          </text>
                        </svg>
                      )
                    })()}

                    <div className="mt-2 flex items-center gap-4 text-xs text-white/60">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2 w-6 rounded-full bg-blue-500" />
                        Paid hours
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2 w-6 rounded-full bg-emerald-500" />
                        Actual hours
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-2">
                {dailySeries.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70">
                    No history yet.
                  </div>
                ) : (
                  dailySeries.map((d) => {
                    const ePct = Math.min(100, (d.earnings / maxDailyEarnings) * 100)
                    const mPct = Math.min(100, (d.actual / maxDailyMinutes) * 100)
                    return (
                      <div key={d.key} className="rounded-xl border border-white/10 bg-white/5 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-white">{labelDay(d.key)}</div>
                          <div className="text-xs text-white/60">
                            {d.rooms} rooms · {formatMinutes(d.actual)}m · {formatAud(d.earnings)}
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2">
                          <div className="h-2 w-full rounded-full bg-white/10">
                            <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${ePct}%` }} />
                          </div>
                          <div className="h-2 w-full rounded-full bg-white/10">
                            <div className="h-2 rounded-full bg-blue-500" style={{ width: `${mPct}%` }} />
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-white/60">
                            <span>Earnings</span>
                            <span>Time</span>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#111A2E] p-4">
              <div className="text-sm font-semibold">Per-room breakdown</div>
              <div className="mt-1 text-xs text-white/60">Bars show actual vs expected minutes.</div>

              <div className="mt-4 space-y-3">
                {completedWithDurations.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70">
                    No completed rooms recorded yet today. Start a room to begin tracking.
                  </div>
                ) : (
                  completedWithDurations.map((w) => {
                    const actual = w.actual_minutes ?? 0
                    const expected = Number(w.expected_minutes) || 0
                    const actualPct = Math.min(100, (actual / maxBar) * 100)
                    const expectedPct = Math.min(100, (expected / maxBar) * 100)

                    return (
                      <div key={w.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-white">
                              Room {formatRoomNumber(w.room_number)} · {taskLabel(w.task)}
                            </div>
                            <div className="mt-1 text-xs text-white/60">
                              Actual: {w.actual_minutes != null ? `${formatMinutes(w.actual_minutes)}m (${formatMinutesAsHours(w.actual_minutes)})` : '—'} ·
                              Expected: {formatMinutes(expected)}m ({formatMinutesAsHours(expected)})
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 space-y-2">
                          <div className="h-2 w-full rounded-full bg-white/10">
                            <div className="h-2 rounded-full bg-blue-500" style={{ width: `${expectedPct}%` }} />
                          </div>
                          <div className="h-2 w-full rounded-full bg-white/10">
                            <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${actualPct}%` }} />
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-white/60">
                            <span>Expected</span>
                            <span>Actual</span>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}
