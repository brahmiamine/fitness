import { installVisualTruthPatches } from './visual-truth.generated'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.DEV) {
  const editorModule = './visual-truth.dev.jsx'
  if (import.meta.env.VITE_VISUAL_TRUTH === '1') {
    void import(/* @vite-ignore */ editorModule).then(({ mountVisualTruth }) => mountVisualTruth()).catch(() => {})
  }
}


installVisualTruthPatches()

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {})
  })
}
