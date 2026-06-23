import { useEffect, useState } from 'react'
import { LIVES } from '../engine/constants'

// Lives shown as heart icons, driven by the engine's live state. Polls game state via rAF (cheap;
// only re-renders when the count actually changes) so it stays in sync without coupling the engine.
export default function Hearts({ total = LIVES }: { total?: number }) {
  const [hearts, setHearts] = useState(total)

  useEffect(() => {
    let raf = 0
    let last = -1
    const tick = () => {
      const h = window.game?.G?.hearts
      if (typeof h === 'number' && h !== last) {
        last = h
        setHearts(h)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="hearts">
      {Array.from({ length: total }, (_, i) => (
        <span key={i}>
          <svg viewBox="0 0 24 24" className={i >= hearts ? 'gone' : ''} xmlns="http://www.w3.org/2000/svg">
            <path
              fill="#FF4B55"
              d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
            />
          </svg>
        </span>
      ))}
    </div>
  )
}
