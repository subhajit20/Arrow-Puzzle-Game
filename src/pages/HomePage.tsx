import { useNavigate } from 'react-router-dom'

// Landing screen: pick a mode. Styled with Tailwind (the game board itself uses game.css).
export default function HomePage() {
  const navigate = useNavigate()
  return (
    <div
      className="mx-auto flex h-[100dvh] w-full max-w-[540px] flex-col items-center justify-center gap-5 px-6"
      style={{ fontFamily: 'var(--font)' }}
    >
      <div className="mb-2 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-[#26324F]">Arrow Escape</h1>
        <p className="mt-1 text-sm font-semibold text-[#8B93A6]">Clear every path off the board</p>
      </div>

      {/* Normal gameplay */}
      <button
        onClick={() => navigate('/play')}
        className="flex w-full items-center gap-4 rounded-3xl bg-gradient-to-br from-[#3D8BFF] to-[#2E6BE0] p-5 text-left text-white shadow-[0_14px_30px_-12px_rgba(61,139,255,0.8)] transition-transform active:scale-[0.97]"
      >
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/20 text-3xl">🎯</div>
        <div>
          <div className="text-xl font-extrabold">Play</div>
          <div className="text-sm font-semibold text-white/85">Milestone puzzles — solo</div>
        </div>
      </button>

      {/* Play with friends */}
      <button
        onClick={() => navigate('/friends')}
        className="flex w-full items-center gap-4 rounded-3xl bg-gradient-to-br from-[#9B5DE5] to-[#F15BB5] p-5 text-left text-white shadow-[0_14px_30px_-12px_rgba(155,93,229,0.8)] transition-transform active:scale-[0.97]"
      >
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/20 text-3xl">👥</div>
        <div>
          <div className="text-xl font-extrabold">Play with Friends</div>
          <div className="text-sm font-semibold text-white/85">Race a friend in real time</div>
        </div>
      </button>
    </div>
  )
}
