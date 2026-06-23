import { useEffect } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import GamePage from './pages/GamePage'
import FriendsPage from './pages/FriendsPage'
import { installButtonSound } from './ui-sound'

// HashRouter (not BrowserRouter) so routes work from file:// inside the Capacitor WebView.
export default function App() {
  useEffect(() => { installButtonSound() }, [])   // one click sound for every button, app-wide
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/play" element={<GamePage />} />
        <Route path="/friends" element={<FriendsPage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </HashRouter>
  )
}
