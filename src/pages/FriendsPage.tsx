import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RaceSocket } from '../net/raceSocket'
import { RaceController } from '../engine/RaceController'

// ── Types (loose; matches backend publicRoom / event payloads) ──────────────
type Player = {
  id: string; name: string; isHost: boolean; status: string
  cleared: number; total: number; placement: number | null
  gamePoints: number; roundsWon: number
}
type Room = {
  code: string; status: string; hostId: string; rounds: number; currentRound: number
  maxPlayers: number; players: Player[]
}
type Phase = 'connecting' | 'entry' | 'lobby' | 'generating' | 'countdown' | 'racing' | 'result' | 'gameover'

const HEART =
  'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'

// One distinct colour per player lane in the bottom race track.
const LANE_COLORS = ['#3D8BFF', '#9B5DE5', '#F15BB5', '#16B26B']

// Mounts a canvas and runs the race engine on a server-provided board.
function RaceBoard({ board, onProgress, onWin, onLifeLost, onLose }: any) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const ctrl = new RaceController(ref.current, board, { onProgress, onWin, onLifeLost, onLose })
    ctrl.start()
    return () => ctrl.destroy()
    // board is fixed for the life of this component (one race)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <canvas ref={ref} />
}

export default function FriendsPage() {
  const navigate = useNavigate()
  const sockRef = useRef<RaceSocket | null>(null)
  const [phase, setPhase] = useState<Phase>('connecting')
  const [err, setErr] = useState('')
  const [name, setName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [rounds, setRounds] = useState(1)
  const [myId, setMyId] = useState('')
  const [room, setRoom] = useState<Room | null>(null)
  const [board, setBoard] = useState<any>(null)
  const [countdownTo, setCountdownTo] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [progress, setProgress] = useState<Record<string, { cleared: number; total: number }>>({})
  const [hearts, setHearts] = useState(3)
  const [myPlacement, setMyPlacement] = useState<number | null>(null)
  const [result, setResult] = useState<any>(null)

  // Connect once on mount; wire all server events.
  useEffect(() => {
    const s = new RaceSocket()
    sockRef.current = s
    let alive = true
    s.connect()
      .then(() => { if (alive) setPhase('entry') })
      .catch(() => { if (alive) { setErr('Cannot reach the race server. Is the backend running?'); setPhase('entry') } })

    const offs = [
      s.on('room:update', (m: any) => setRoom(m.room)),
      s.on('race:generating', () => setPhase('generating')),
      s.on('race:countdown', (m: any) => { setCountdownTo(m.startAt); setPhase('countdown') }),
      s.on('race:start', (m: any) => {
        setBoard(m.board); setRoom(m.room); setProgress({}); setHearts(3); setMyPlacement(null); setResult(null)
        setPhase('racing')
      }),
      s.on('race:progress', (m: any) =>
        setProgress((p) => ({ ...p, [m.playerId]: { cleared: m.cleared, total: m.total } }))),
      s.on('race:placement', (m: any) =>
        setRoom((r) => r ? { ...r, players: r.players.map(pl => pl.id === m.playerId ? { ...pl, placement: m.placement } : pl) } : r)),
      s.on('round:result', (m: any) => { setResult(m); setPhase('result') }),
      s.on('game:over', (m: any) => { setResult(m); setPhase('gameover') }),
      s.on('__close', () => { if (alive) setErr('Disconnected from the race server.') }),
    ]
    const tick = setInterval(() => setNow(Date.now()), 200)
    return () => { alive = false; clearInterval(tick); offs.forEach(off => off()); s.send('room:leave'); s.close() }
  }, [])

  const create = async () => {
    try { const r: any = await sockRef.current!.request('room:create', { name: name || 'Player' }); setMyId(r.playerId); setRoom(r.room); setPhase('lobby'); setErr('') }
    catch (e: any) { setErr(e.message) }
  }
  const join = async () => {
    try { const r: any = await sockRef.current!.request('room:join', { code: joinCode, name: name || 'Player' }); setMyId(r.playerId); setRoom(r.room); setPhase('lobby'); setErr('') }
    catch (e: any) { setErr(e.message) }
  }
  const start = async () => {
    try { await sockRef.current!.request('room:start', { rounds }) } catch (e: any) { setErr(e.message) }
  }
  const leave = () => { sockRef.current?.send('room:leave'); navigate('/') }

  const onProgress = (cleared: number, total: number) => {
    setProgress((p) => ({ ...p, [myId]: { cleared, total } }))
    sockRef.current?.send('race:progress', { cleared, total })
  }
  const onWin = async (order: number[]) => {
    try { const r: any = await sockRef.current!.request('race:finished', { order }); setMyPlacement(r.placement) }
    catch (e: any) { setErr('Finish rejected: ' + e.message) }
  }

  const wrap = 'mx-auto flex h-[100dvh] w-full max-w-[540px] flex-col'
  const pad = 'flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center'
  const font = { fontFamily: 'var(--font)' }

  // ── Entry ────────────────────────────────────────────────────────────────
  if (phase === 'connecting' || phase === 'entry') {
    return (
      <div className={wrap} style={font}>
        <div className={pad}>
          <h1 className="text-3xl font-extrabold text-[#26324F]">Play with Friends</h1>
          {err && <p className="text-sm font-semibold text-[#FF4B55]">{err}</p>}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={16}
            className="w-full rounded-2xl bg-[#EEF1F6] px-4 py-3 text-center text-lg font-bold text-[#26324F] outline-none" />
          <button onClick={create} disabled={phase === 'connecting'}
            className="w-full rounded-2xl bg-[#3D8BFF] py-3.5 text-[17px] font-extrabold text-white shadow-[0_10px_20px_-8px_rgba(61,139,255,0.6)] active:scale-95 disabled:opacity-50">
            Create room
          </button>
          <div className="flex w-full gap-2">
            <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="CODE" maxLength={6}
              className="min-w-0 flex-1 rounded-2xl bg-[#EEF1F6] px-4 py-3 text-center text-lg font-extrabold tracking-widest text-[#26324F] outline-none" />
            <button onClick={join} disabled={phase === 'connecting' || !joinCode}
              className="rounded-2xl bg-[#9B5DE5] px-6 py-3 font-extrabold text-white active:scale-95 disabled:opacity-50">Join</button>
          </div>
          <button onClick={leave} className="mt-2 text-sm font-semibold text-[#8B93A6]">← Back</button>
        </div>
      </div>
    )
  }

  // ── Lobby (also shown after game over to start again) ──────────────────────
  if (phase === 'lobby' || phase === 'generating') {
    const isHost = room?.hostId === myId
    return (
      <div className={wrap} style={font}>
        <div className={pad}>
          <p className="text-sm font-bold uppercase tracking-widest text-[#8B93A6]">Room code</p>
          <div className="rounded-2xl bg-[#EEF1F6] px-8 py-3 text-4xl font-extrabold tracking-[0.2em] text-[#26324F]">{room?.code}</div>
          {err && <p className="text-sm font-semibold text-[#FF4B55]">{err}</p>}
          <div className="w-full space-y-2">
            {room?.players.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-xl bg-[#F4F6FB] px-4 py-2.5">
                <span className="font-bold text-[#26324F]">{p.name}{p.id === myId ? ' (you)' : ''}</span>
                <span className="text-xs font-bold text-[#8B93A6]">{p.isHost ? 'HOST' : ''}</span>
              </div>
            ))}
          </div>
          {phase === 'generating'
            ? <p className="font-bold text-[#3D8BFF]">Building board…</p>
            : isHost ? (
              <div className="flex w-full items-center gap-2">
                <select value={rounds} onChange={(e) => setRounds(+e.target.value)}
                  className="rounded-2xl bg-[#EEF1F6] px-4 py-3 font-extrabold text-[#26324F]">
                  {[1, 3, 5, 7].map(n => <option key={n} value={n}>{n} round{n > 1 ? 's' : ''}</option>)}
                </select>
                <button onClick={start} disabled={(room?.players.length || 0) < 2}
                  className="flex-1 rounded-2xl bg-[#16B26B] py-3.5 font-extrabold text-white active:scale-95 disabled:opacity-50">
                  {(room?.players.length || 0) < 2 ? 'Waiting for players…' : 'Start race'}
                </button>
              </div>
            ) : <p className="font-bold text-[#8B93A6]">Waiting for the host to start…</p>}
          <button onClick={leave} className="mt-2 text-sm font-semibold text-[#8B93A6]">← Leave room</button>
        </div>
      </div>
    )
  }

  // ── Countdown ──────────────────────────────────────────────────────────────
  if (phase === 'countdown') {
    const secs = Math.max(0, Math.ceil((countdownTo - now) / 1000))
    return (
      <div className={wrap} style={font}>
        <div className={pad}>
          <p className="text-sm font-bold uppercase tracking-widest text-[#8B93A6]">Round {room?.currentRound}/{room?.rounds}</p>
          <div className="text-7xl font-extrabold text-[#3D8BFF]">{secs || 'GO'}</div>
          <p className="font-bold text-[#26324F]">Get ready…</p>
        </div>
      </div>
    )
  }

  // ── Racing ───────────────────────────────────────────────────────────────
  if (phase === 'racing' && board) {
    const players = room?.players || []
    return (
      <div className="app" style={font}>
        <div className="topbar">
          <button className="icon-btn" onClick={leave}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#3D8BFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <div className="title">Round {room?.currentRound}/{room?.rounds}</div>
          <div className="hearts">
            {[0, 1, 2].map(i => (
              <svg key={i} viewBox="0 0 24 24" className={i >= hearts ? 'gone' : ''}><path fill="#FF4B55" d={HEART} /></svg>
            ))}
          </div>
        </div>
        <div className="stage">
          <RaceBoard board={board} onProgress={onProgress} onWin={onWin}
            onLifeLost={(h: number) => setHearts(h)} onLose={() => setErr('Out of lives!')} />
          {myPlacement != null && (
            <div className="overlay show" style={{ background: 'rgba(255,255,255,.9)' }}>
              <div className="card">
                <p className="big">You finished #{myPlacement}!</p>
                <p className="sm">Waiting for the round to end…</p>
              </div>
            </div>
          )}
        </div>

        {/* Bottom race track — ONE shared track; every player is a runner on it, advancing to 🏁 */}
        <div className="shrink-0 border-t border-[#E4E9F1] bg-[#EEF1F6] px-4 py-3">
          {/* legend: each player + their progress, in their lane colour */}
          <div className="mb-2 flex flex-wrap justify-center gap-x-3 gap-y-0.5 text-xs font-extrabold">
            {players.map((p, i) => {
              const color = LANE_COLORS[i % LANE_COLORS.length]
              const pr = progress[p.id] || { cleared: 0, total: p.total || board.arrows.length }
              const pct = pr.total ? Math.min(100, Math.round((pr.cleared / pr.total) * 100)) : 0
              const done = p.placement != null
              return (
                <span key={p.id} style={{ color }}>
                  {p.name}{p.id === myId ? ' (you)' : ''} · {done ? `#${p.placement}` : pct + '%'}
                </span>
              )
            })}
          </div>
          {/* the single track with one marker per player */}
          <div className="relative h-6 rounded-full" style={{ background: '#E4E9F1' }}>
            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-sm leading-none">🏁</span>
            {players.map((p, i) => {
              const color = LANE_COLORS[i % LANE_COLORS.length]
              const pr = progress[p.id] || { cleared: 0, total: p.total || board.arrows.length }
              const pct = pr.total ? Math.min(100, Math.round((pr.cleared / pr.total) * 100)) : 0
              const done = p.placement != null
              return (
                <div key={p.id}
                  className="absolute top-1/2 grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white text-[10px] font-extrabold text-white shadow transition-[left] duration-300"
                  style={{ left: `clamp(12px, ${pct}%, calc(100% - 16px))`, background: color, zIndex: 10 - i }}
                  title={p.name}>
                  {done ? '✓' : (p.name?.[0] || '?').toUpperCase()}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // ── Round result / game over ───────────────────────────────────────────────
  if (phase === 'result' || phase === 'gameover') {
    const standings = result?.standings || []
    const champions = result?.champions || []
    return (
      <div className={wrap} style={font}>
        <div className={pad}>
          <h1 className="text-3xl font-extrabold text-[#26324F]">
            {phase === 'gameover' ? '🏆 Game Over' : `Round ${result?.round}/${result?.totalRounds} done`}
          </h1>
          {phase === 'gameover' && champions.length > 0 &&
            <p className="text-lg font-extrabold text-[#16B26B]">Champion: {champions.map((c: any) => c.name).join(', ')}</p>}
          <div className="w-full space-y-2">
            {standings.map((p: any, i: number) => (
              <div key={p.id} className="flex items-center justify-between rounded-xl bg-[#F4F6FB] px-4 py-2.5">
                <span className="font-bold text-[#26324F]">{i + 1}. {p.name}</span>
                <span className="font-extrabold text-[#3D8BFF]">{p.gamePoints} pts</span>
              </div>
            ))}
          </div>
          {phase === 'result'
            ? <p className="font-bold text-[#8B93A6]">Next round starting…</p>
            : <button onClick={leave} className="mt-2 rounded-2xl bg-[#3D8BFF] px-8 py-3.5 font-extrabold text-white active:scale-95">Back to home</button>}
        </div>
      </div>
    )
  }

  return null
}
