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
