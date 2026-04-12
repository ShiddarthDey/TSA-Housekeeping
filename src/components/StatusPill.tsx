import type { PostReleaseRequest, RoomStatus, RoomTask } from '@/utils/domain'
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

export default function StatusPill({
  status,
  task,
  postReleaseRequest,
}: {
  status: RoomStatus
  task?: RoomTask | null
  postReleaseRequest?: PostReleaseRequest | null
}) {
  const isRequested = status === 'released' && postReleaseRequest != null
  const label = isRequested ? 'Requested' : statusLabel(status, task)
  const classes = isRequested
    ? 'bg-violet-500/15 text-violet-200 ring-1 ring-violet-400/20'
    : pillClasses(status)

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${classes}`}>
      {label}
    </span>
  )
}

