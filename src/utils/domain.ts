export type Role = 'manager' | 'supervisor' | 'attendant' | 'houseman' | 'public_area' | 'ra'

export type RoomStatus = 'dirty' | 'in_progress' | 'pending_inspection' | 'released'

export type RoomTask = 'checkout' | 'stay' | 'vip_stay' | 'linen_change' | 'full_service'

export type PostReleaseRequest = 'houseman' | 'public_area'

export type RoomType = 'king' | 'twin' | 'triple'

export type Profile = {
  id: string
  role: Role
  name: string | null
  is_active?: boolean | null
}

export type Room = {
  room_number: number
  status: RoomStatus
  task?: RoomTask | null
  post_release_request?: PostReleaseRequest | null
  post_release_request_details?: unknown | null
  post_release_request_rush?: boolean | null
  post_release_request_claimed_by?: string | null
  post_release_request_claimed_at?: string | null
  dnd?: boolean | null
  dnd_by?: string | null
  dnd_at?: string | null
  assigned_to: string | null
  inspected_by?: string | null
  released_by?: string | null
  released_at?: string | null
  updated_at?: string
}

export type RoomWork = {
  id: string
  room_number: number
  staff_id: string
  task: RoomTask
  started_at: string
  done_at: string | null
  expected_minutes: number
  created_at?: string
}

export const roomStatusOrder: RoomStatus[] = ['dirty', 'in_progress', 'pending_inspection', 'released']

export function statusLabel(status: RoomStatus, task?: RoomTask | null): string {
  switch (status) {
    case 'dirty':
      return 'Dirty'
    case 'in_progress':
      return 'In Progress'
    case 'pending_inspection':
      return task && task !== 'checkout' ? 'Room Cleaned' : 'Pending Inspection'
    case 'released':
      return 'Released'
  }
}

export function taskLabel(task: RoomTask): string {
  switch (task) {
    case 'checkout':
      return 'Checkout'
    case 'stay':
      return 'Stay'
    case 'vip_stay':
      return 'VIP Stay'
    case 'linen_change':
      return 'Linen Change'
    case 'full_service':
      return 'Full Service'
  }
}

export function postReleaseRequestLabel(req: PostReleaseRequest): string {
  switch (req) {
    case 'houseman':
      return 'Request for Houseman'
    case 'public_area':
      return 'Request for Public Area'
  }
}

export function formatRoomNumber(roomNumber: number): string {
  if (roomNumber >= 9001 && roomNumber <= 9005) return `M${roomNumber - 9000}`
  return String(roomNumber)
}

export function roomType(roomNumber: number): RoomType {
  if (roomNumber >= 9001 && roomNumber <= 9005) return 'king'

  const floor = Math.floor(roomNumber / 100)
  const nn = roomNumber % 100

  if (floor >= 1 && floor <= 3) {
    if (nn === 5) return 'triple'
    return 'king'
  }

  if (floor >= 4 && floor <= 6) {
    if (nn === 5) return 'triple'
    if (nn === 7 || nn === 14 || nn === 25 || nn === 27 || nn === 29 || nn === 32 || nn === 34) return 'twin'
    return 'king'
  }

  return 'king'
}

export function roomTypeLabel(t: RoomType): string {
  switch (t) {
    case 'king':
      return 'King'
    case 'twin':
      return 'Twin'
    case 'triple':
      return 'Triple'
  }
}

export function estimatedMinutesForRoomType(t: RoomType): number {
  if (t === 'king') return 20
  if (t === 'twin') return 22
  return 24
}

export function estimatedMinutesForRoom(roomNumber: number): number {
  return estimatedMinutesForRoomType(roomType(roomNumber))
}

export function estimatedMinutesForTaskAndRoomType(task: RoomTask, t: RoomType): number {
  if (task === 'stay') {
    if (t === 'king') return 12
    if (t === 'twin') return 13.8
    return 15
  }

  return estimatedMinutesForRoomType(t)
}

export function estimatedMinutesForRoomAndTask(roomNumber: number, task: RoomTask): number {
  return estimatedMinutesForTaskAndRoomType(task, roomType(roomNumber))
}

export function formatMinutes(minutes: number): string {
  if (Number.isInteger(minutes)) return String(minutes)
  return minutes.toFixed(1)
}

export function formatMinutesAsHours(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h <= 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

export function shiftCapacityMinutes(role: Role): number | null {
  if (role === 'houseman') return 7.5 * 60
  if (role === 'public_area') return 5 * 60
  return null
}

export function shiftCapacityLabel(role: Role): string | null {
  if (role === 'houseman') return '7.5h shift'
  if (role === 'public_area') return '5h shift'
  return null
}

export function payRateAud(date: Date): number {
  const day = date.getDay()
  if (day === 6) return 32
  if (day === 0) return 38
  return 25.8
}

export function formatAud(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(safe)
}

export function roleLabel(role: Role): string {
  switch (role) {
    case 'manager':
      return 'Manager'
    case 'supervisor':
      return 'Supervisor'
    case 'attendant':
      return 'Attendant'
    case 'houseman':
      return 'Houseman'
    case 'public_area':
      return 'Public Area'
    case 'ra':
      return 'Staff (RA)'
  }
}

export function normalizeRole(role: unknown): Role | null {
  const raw = typeof role === 'string' ? role : ''
  const v = raw.trim().toLowerCase()

  if (v === 'public area') return 'public_area'
  if (v === 'room attendant') return 'ra'
  if (v === 'staff') return 'ra'

  if (
    v === 'manager' ||
    v === 'supervisor' ||
    v === 'attendant' ||
    v === 'houseman' ||
    v === 'public_area' ||
    v === 'ra'
  ) {
    return v
  }

  return null
}

export function canViewAllRooms(role: Role): boolean {
  return role === 'manager' || role === 'supervisor'
}

export function allowedNextStatuses(
  role: Role,
  current: RoomStatus,
  assignedToSelf: boolean = false,
  task?: RoomTask | null,
): RoomStatus[] {
  if (role === 'manager') return roomStatusOrder.filter((s) => s !== current)

  if (role === 'supervisor') {
    if (assignedToSelf) {
      if (current === 'dirty') return ['in_progress']
      if (current === 'in_progress') return ['pending_inspection']
    }
    if (current === 'pending_inspection') return task && task !== 'checkout' ? [] : ['released']
    return []
  }

  if (role === 'attendant' || role === 'houseman' || role === 'public_area' || role === 'ra') {
    if (current === 'dirty') return ['in_progress']
    if (current === 'in_progress') return ['pending_inspection']
    return []
  }

  return []
}

export function actionLabel(role: Role, toStatus: RoomStatus): string {
  if (role === 'supervisor' && toStatus === 'released') return 'Release'

  if (role === 'supervisor' || role === 'attendant' || role === 'houseman' || role === 'public_area' || role === 'ra') {
    if (toStatus === 'in_progress') return 'Start Room'
    if (toStatus === 'pending_inspection') return 'Room Done'
  }

  return `Move to ${statusLabel(toStatus)}`
}

