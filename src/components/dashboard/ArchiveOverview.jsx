import {
  Award,
  Battery,
  Bell,
  Database,
  FileArchive,
  Footprints,
  HeartPulse,
  MoonStar,
  RefreshCw,
  Sparkles,
  Watch,
} from 'lucide-react'
import { formatBytes, formatDateTime, formatLocalDateTime, formatNumber, formatTime } from '../../lib/format'
import { LineChart } from '../Charts'
import { ArchiveInventory, DetailTable } from '../DataDetails'
import { TechnicalMode } from '../TechnicalMode'
import { appLabel, MetricRow, SectionHeading } from './shared'

const ACHIEVEMENT_CATEGORY_ICONS = {
  steps: Footprints,
  sleep: MoonStar,
  recovery: HeartPulse,
}

function AchievementsSection({ achievements }) {
  if (!achievements.length) return null
  return (
    <section className="content-section">
      <SectionHeading
        icon={Award}
        title="Succès débloqués"
        description="Badges internes de Notify, décodés depuis les réglages de l’appareil sans toucher aux jetons ni aux réglages liés."
      />
      <div className="achievement-grid">
        {achievements.map((badge) => {
          const Icon = ACHIEVEMENT_CATEGORY_ICONS[badge.category] || Sparkles
          return (
            <article key={badge.id} className="achievement-card">
              <span className="achievement-card__icon"><Icon size={20} aria-hidden="true" /></span>
              <div>
                <strong>{badge.label}</strong>
                <span className="achievement-card__category">{badge.categoryLabel}</span>
                {badge.description && <p>{badge.description}</p>}
                <small>
                  Débloqué le {formatLocalDateTime(badge.unlockedAt)}
                  {badge.period ? ` · ${badge.period}` : ''}
                </small>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export function ArchiveOverview({ dataset }) {
  const notifications = dataset.metadata?.notificationApps || dataset.notifications || []
  const appStats = dataset.appStats || []
  const achievements = dataset.achievements || []
  const battery = dataset.battery || []
  const statistics = dataset.statistics || []
  const lastStats = statistics.find((item) => item.name === 'last') || statistics[0]
  const notificationTotal = notifications.reduce((sum, row) => sum + row.total, 0)

  return (
    <>
      <section className="content-section">
        <SectionHeading icon={Watch} title="Appareil et sauvegarde" description="Provenance, volume et couverture technique de l’import." />
        {dataset.schemaVersion < 5 && <p className="schema-warning">Cette sauvegarde a été importée avec l’ancienne version du lecteur. Réimportez le fichier NXK pour calculer le rapport de qualité, les comparaisons, le mode technique et les succès débloqués.</p>}
        <dl className="fact-grid">
          <div><Watch size={18} aria-hidden="true" /><dt>Appareil</dt><dd>{dataset.device?.name || 'Non identifié'}</dd></div>
          <div><FileArchive size={18} aria-hidden="true" /><dt>Archive</dt><dd>{dataset.fileName}<small>{formatBytes(dataset.fileSize)}</small></dd></div>
          <div><Database size={18} aria-hidden="true" /><dt>Base SQLite</dt><dd>{formatNumber(dataset.metadata?.totalRows || 0)} lignes<small>{formatNumber(dataset.metadata?.coverage?.dayCount || dataset.days.length)} jours · {formatNumber(dataset.metadata?.tableCount || 0)} tables</small></dd></div>
          <div><RefreshCw size={18} aria-hidden="true" /><dt>Synchronisations</dt><dd>{formatNumber(dataset.metadata?.syncCount || 0)}<small>dernière : {formatDateTime(dataset.metadata?.lastSync || 0)}</small></dd></div>
        </dl>
      </section>

      <AchievementsSection achievements={achievements} />

      <section className="content-section">
        <SectionHeading icon={Bell} title="Notifications transmises au bracelet" description="Compteurs uniquement : aucun contenu de message n’est présent dans ces tables." />
        <MetricRow items={[
          { label: 'Notifications recensées', value: formatNumber(notificationTotal || lastStats?.totalNotifications || 0) },
          { label: 'Filtrées', value: formatNumber(notifications.reduce((sum, row) => sum + row.filtered, 0)) },
          { label: 'Vibrations', value: formatNumber(lastStats?.vibrations || 0) },
          { label: 'Cadrans transférés', value: formatNumber(lastStats?.watchfaces || 0) },
        ]} />
        <DetailTable
          title="Répartition par application"
          rows={notifications}
          columns={[
            { label: 'Application', render: (row) => appLabel(row.appName) },
            { label: 'Total', render: (row) => formatNumber(row.total) },
            { label: 'Filtrées', render: (row) => formatNumber(row.filtered) },
          ]}
        />
        <DetailTable
          title="Compteurs internes par application"
          description="Notify conserve deux compteurs cumulés par application (type 1 et type 3). Leur différence exacte n’étant pas documentée, ils sont affichés côte à côte plutôt qu’additionnés."
          rows={appStats}
          columns={[
            { label: 'Application', render: (row) => appLabel(row.appName) },
            { label: 'Compteur type 1', render: (row) => formatNumber(row.counters[1] || 0) },
            { label: 'Compteur type 3', render: (row) => formatNumber(row.counters[3] || 0) },
          ]}
        />
      </section>

      <section className="content-section">
        <SectionHeading icon={Battery} title="Batterie enregistrée" description="Valeurs consignées par Notify dans le journal de l’appareil." />
        <LineChart
          data={battery.map((row) => ({ value: row.value, label: formatTime(row.dateTime, row.tz) }))}
          label="Niveau de batterie"
          unit="%"
          color="var(--success)"
          emptyLabel="Aucun relevé de batterie disponible"
        />
      </section>

      <ArchiveInventory dataset={dataset} />
      <TechnicalMode dataset={dataset} />
    </>
  )
}
