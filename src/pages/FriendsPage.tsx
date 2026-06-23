import { useNavigate } from 'react-router-dom'

// Placeholder for the upcoming multiplayer "play with friends" flow (lobby / rooms / live race).
export default function FriendsPage() {
  const navigate = useNavigate()
  return (
    <div
      className="mx-auto flex h-[100dvh] w-full max-w-[540px] flex-col items-center justify-center gap-4 px-6 text-center"
      style={{ fontFamily: 'var(--font)' }}
    >
      <div className="text-6xl">👥</div>
      <h1 className="text-3xl font-extrabold text-[#26324F]">Play with Friends</h1>
      <p className="max-w-xs text-sm font-semibold text-[#8B93A6]">
        Real-time races are coming soon — invite a friend with a room code and solve the same board head-to-head.
      </p>
      <button
        onClick={() => navigate('/')}
        className="mt-2 rounded-2xl bg-[#3D8BFF] px-8 py-3.5 text-[17px] font-extrabold text-white shadow-[0_10px_20px_-8px_rgba(61,139,255,0.6)] transition-transform active:scale-95"
      >
        Back
      </button>
    </div>
  )
}
