// Global UI click sound: every <button> in the app plays this one effect on press. Installed once
// (App mount) via a document-level listener, so it covers buttons on every page — home cards, back,
// hint, sound toggle, "Next level", etc. — without wiring each handler. Respects the same mute flag
// as the rest of the audio (toggled by the speaker button, stored in localStorage). A click is a
// user gesture, so play() is always allowed.
import clickUrl from './assets/click.mp3'

const isMuted = () => localStorage.getItem('arrowEscapeMuted') === '1'

export function playClick() {
  if (isMuted()) return
  try {
    const a = new Audio(clickUrl)   // fresh element per click → rapid presses overlap cleanly
    a.volume = 0.5
    a.play().catch(() => { /* ignore */ })
  } catch { /* ignore */ }
}

let installed = false
export function installButtonSound() {
  if (installed) return
  installed = true
  // Capture phase so the sound fires even if a handler stops propagation or navigates away.
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target as Element | null
      if (el && el.closest('button')) playClick()
    },
    true,
  )
}
