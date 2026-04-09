import type { RoomStatus, RoomTask } from '@/utils/domain'
import { statusLabel } from '@/utils/domain'

function pillClasses(status: RoomStatus): string {
  switch (status) {
    case 'dirty':
      return 'bg-red-500/15 text-red-200 ring-1 ring-red-400/20'
    case 'in_progress':
      return 'bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/20'
    case 'pending_inspection':
      return 'bg-blue-500/15 text-blue-200 ring-1 ring-blue-400/20'
    case 'released':
      return 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/20'
  }
}

export default function StatusPill({ status, task }: { status: RoomStatus; task?: RoomTask | null }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${pillClasses(status)}`}>
      {statusLabel(status, task)}
    </span>
  )
}

