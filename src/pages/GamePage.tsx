import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { GameController } from '../engine/GameController'
import { BgAudio } from '../engine/BgAudio'
import Hearts from '../components/Hearts'
import bgmUrl from '../assets/bgm.mp3'
import tapUrl from '../assets/tap.mp3'

export default function GamePage() {
  const navigate = useNavigate()
  useEffect(() => {
    // Boot the imperative engine for this visit. On entry it resumes the saved board (via
    // Persistence); on leave we tear it down (stop loop, detach input, remove listeners).
    const game = new GameController()
    game.start()
    const bg = new BgAudio()
    window.game = game
    window.bgAudio = bg
    // The top-bar back button returns to the home screen (overrides the engine's default binding).
    const back = document.getElementById('backBtn')
    if (back) back.onclick = () => navigate('/')

    return () => {
      try { bg.stop() } catch { /* ignore */ }
      try { game.destroy() } catch { /* ignore */ }
      window.game = undefined
      window.bgAudio = undefined
    }
  }, [navigate])

  return (
    <>
      <div className="app">
        <div className="topbar">
          <button className="icon-btn" id="backBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="#3D8BFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <div className="title" id="level">Level 1</div>
          <button className="icon-btn" id="soundBtn" aria-label="Toggle sound"></button>
        </div>

        <div className="statusbar">
          <div className="pill">
            <svg viewBox="0 0 24 24" fill="none" stroke="#26324F" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17L17 7" />
              <path d="M8 7h9v9" />
            </svg>
            <span id="count">0</span>
          </div>
          <Hearts />
          <div className="diff" id="diff">Hard</div>
        </div>

        <div className="stage">
          <canvas id="board"></canvas>
          <div className="overlay" id="overlay">
            <div className="confetti" id="confetti" aria-hidden="true"></div>
            <div className="card">
              <div className="trophy" aria-hidden="true">
                <svg viewBox="0 0 120 120">
                  <defs>
                    <linearGradient id="goldG" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#FFE9A8" />
                      <stop offset="0.5" stopColor="#FFC53D" />
                      <stop offset="1" stopColor="#F5A623" />
                    </linearGradient>
                  </defs>
                  <path d="M34 28 C14 28 16 54 40 54" fill="none" stroke="url(#goldG)" strokeWidth="7" />
                  <path d="M86 28 C106 28 104 54 80 54" fill="none" stroke="url(#goldG)" strokeWidth="7" />
                  <path d="M34 20 H86 V40 C86 61 74 73 60 73 C46 73 34 61 34 40 Z" fill="url(#goldG)" />
                  <rect x="55" y="72" width="10" height="14" fill="#F0A91E" />
                  <rect x="44" y="86" width="32" height="8" rx="3" fill="url(#goldG)" />
                  <rect x="37" y="94" width="46" height="10" rx="4" fill="#E8920C" />
                  <path d="M60 31 L63.2 39.6 L72.4 40.0 L65.2 45.7 L67.6 54.5 L60 49.5 L52.4 54.5 L54.8 45.7 L47.6 40.0 L56.8 39.6 Z" fill="#fff" opacity="0.92" />
                </svg>
              </div>
              <p className="big" id="cardTitle">Level cleared</p>
              <img className="win-shot" id="winShot" alt="The board you solved" />
              <p className="points" id="cardPoints"><span className="lbl">Points</span><span id="pointsVal">0</span></p>
              <p className="sm" id="cardSub"></p>
              <button id="cardBtn">Next level</button>
            </div>
          </div>
        </div>

        <div className="tools">
          <button className="hint-btn" id="hintBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18h6" />
              <path d="M10 21h4" />
              <path d="M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.3 1 2.1V16h6v-.4c0-.8.4-1.5 1-2.1A6 6 0 0 0 12 3z" />
            </svg>
            <span className="n" id="hintN">3</span>
          </button>
        </div>
      </div>

      <div className="fx" id="fx" aria-hidden="true"></div>

      <audio id="bgm" loop preload="auto">
        <source src={bgmUrl} type="audio/mpeg" />
      </audio>
      <audio id="tapSfx" preload="auto">
        <source src={tapUrl} type="audio/mpeg" />
      </audio>
    </>
  )
}
