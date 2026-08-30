import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, Smartphone, X } from 'lucide-react'

function isStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
}

function isAppleMobile() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
    || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)
}

export function InstallApp({ compact = false }) {
  const [promptEvent, setPromptEvent] = useState(null)
  const [installed, setInstalled] = useState(() => isStandaloneMode())
  const [showAppleGuide, setShowAppleGuide] = useState(false)
  const guideRef = useRef(null)
  const appleMobile = isAppleMobile()

  useEffect(() => {
    const handlePrompt = (event) => {
      event.preventDefault()
      setPromptEvent(event)
    }
    const handleInstalled = () => {
      setInstalled(true)
      setPromptEvent(null)
    }
    window.addEventListener('beforeinstallprompt', handlePrompt)
    window.addEventListener('appinstalled', handleInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handlePrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  useEffect(() => {
    const dialog = guideRef.current
    if (!dialog) return
    if (showAppleGuide && !dialog.open) dialog.showModal()
    if (!showAppleGuide && dialog.open) dialog.close()
  }, [showAppleGuide])

  async function handleInstall(event) {
    if (appleMobile) {
      event.currentTarget.closest('dialog')?.close()
      setShowAppleGuide(true)
      return
    }
    if (!promptEvent) return
    await promptEvent.prompt()
    const choice = await promptEvent.userChoice
    if (choice.outcome === 'accepted') setPromptEvent(null)
  }

  if (installed || (!appleMobile && !promptEvent)) return null

  return (
    <>
      <button className={`install-app${compact ? ' install-app--compact' : ''}`} type="button" onClick={handleInstall}>
        <Download size={18} aria-hidden="true" />
        <span>Installer Pulse</span>
      </button>
      {appleMobile && createPortal(
        <dialog
          ref={guideRef}
          className="install-dialog"
          aria-labelledby="install-guide-title"
          onClose={() => setShowAppleGuide(false)}
          onClick={(event) => {
            if (event.target === event.currentTarget) event.currentTarget.close()
          }}
        >
          <div className="install-guide">
            <header>
              <span><Smartphone size={21} aria-hidden="true" /></span>
              <div><h2 id="install-guide-title">Installer Pulse sur l’iPhone</h2><p>Une installation sans App Store.</p></div>
              <button className="icon-button" type="button" aria-label="Fermer" onClick={() => guideRef.current?.close()}><X size={20} /></button>
            </header>
            <ol>
              <li><strong>Ouvrez la page dans Safari</strong><span>Si vous utilisez un autre navigateur, copiez d’abord le lien dans Safari.</span></li>
              <li><strong>Appuyez sur Partager</strong><span>L’icône se trouve dans la barre de Safari.</span></li>
              <li><strong>Choisissez « Sur l’écran d’accueil »</strong><span>Puis confirmez avec « Ajouter ».</span></li>
            </ol>
            <p className="install-guide__note">Pulse s’ouvrira ensuite comme une application, avec son icône et son écran de démarrage.</p>
          </div>
        </dialog>,
        document.body,
      )}
    </>
  )
}
