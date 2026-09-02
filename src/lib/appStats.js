function number(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * `statsApp` conserve deux compteurs internes par application côté Notify (type 1 et type 3).
 * Leur différence exacte n’est pas documentée publiquement : ils sont donc présentés côte à
 * côte, sans être additionnés ni interprétés, pour éviter tout double comptage supposé.
 */
export function parseAppStats(rows = []) {
  const byApp = new Map()
  for (const row of rows) {
    const rawName = String(row.name ?? '')
    const type = number(row.type)
    const appName = rawName.replace(/^\d+_/, '') || rawName
    if (!byApp.has(appName)) byApp.set(appName, { appName, counters: {} })
    byApp.get(appName).counters[type] = number(row.notificationTotalCounter)
  }
  return [...byApp.values()].sort(
    (a, b) => Object.values(b.counters).reduce((sum, value) => sum + value, 0)
      - Object.values(a.counters).reduce((sum, value) => sum + value, 0),
  )
}
