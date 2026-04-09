export default function LoadingScreen() {
  return (
    <div className="min-h-dvh bg-[#0B1220] text-[#E5E7EB] flex items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#111A2E] p-6">
        <div className="h-4 w-32 rounded bg-white/10 animate-pulse" />
        <div className="mt-4 space-y-2">
          <div className="h-3 w-full rounded bg-white/10 animate-pulse" />
          <div className="h-3 w-5/6 rounded bg-white/10 animate-pulse" />
        </div>
      </div>
    </div>
  )
}

