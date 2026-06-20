import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { configureApi } from '@splitstupid/core'
import App from './App'
import './styles.css'

// Point @splitstupid/core's API client at the Worker. The web app reads it
// from Vite's build-time env; the RN app injects its own in mobile/.
configureApi({ baseUrl: import.meta.env.VITE_API_URL })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
