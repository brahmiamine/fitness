import { createRoot } from 'react-dom/client'
import { VisualTruth } from 'visual-truth'
import 'visual-truth/style.css'

export function mountVisualTruth() {
  const host = document.createElement('div')
  host.dataset.visualTruthHost = ''
  document.body.append(host)
  createRoot(host).render(<VisualTruth />)
}
