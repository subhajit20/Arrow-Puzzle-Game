import { createRoot } from 'react-dom/client'
import './index.css'
import './game.css'
import App from './App.tsx'

// No StrictMode: the canvas engine inits imperatively in a useEffect, and StrictMode's double-mount
// would start two game loops. Single mount keeps the engine init clean.
createRoot(document.getElementById('root')!).render(<App />)
