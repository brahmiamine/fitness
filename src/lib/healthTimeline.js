import { loadImportDay } from './storage'
import { buildDailyHealthSnapshot } from './dailyHealthSnapshot'

/**
 * Duplicate-day policy: when several stored backups cover the same day,
 * the entire day comes from the single most recently imported backup that
 * has it. This mirrors the app's documented history-consolidation rule
 * (see README) and guarantees a day never silently mixes stale fields from
 * an older backup with fresh ones from a newer backup.
 */
export function pickFreshestImport(imports) {
  return [...imports].sort((a, b) => String(b.importedAt || '').localeCompare(String(a.importedAt || '')))[0] || null
}

function importsCoveringDay(imports, day) {
  return imports.filter((item) => (item.days || []).some((entry) => entry.day === day))
}

async function snapshotFromImport(day, item) {
  const chunk = await loadImportDay(item, day)
  const dayMeta = (item.days || []).find((entry) => entry.day === day)
  return buildDailyHealthSnapshot({
    day,
    dayMeta,
    chunk,
    source: { importId: item.id, fileName: item.fileName, importedAt: item.importedAt },
    reminders: item.reminders,
  })
}

/**
 * Builds the snapshot for a single day across every stored backup.
 * Returns null when no stored import has data for that day.
 */
export async function loadDailyHealthSnapshot(day, imports) {
  const candidates = importsCoveringDay(imports, day)
  const freshest = pickFreshestImport(candidates)
  if (!freshest) return null
  return snapshotFromImport(day, freshest)
}

/**
 * Builds the full longitudinal timeline: one DailyHealthSnapshot per
 * calendar day known to any stored backup, ordered chronologically.
 * Partial backups (only some health domains present) are supported since
 * each domain's absence is simply reflected in that day's completeness.
 */
export async function buildHealthTimeline(imports, { fromDay, toDay } = {}) {
  const importsByDay = new Map()
  for (const item of imports) {
    for (const entry of item.days || []) {
      if (!entry.day) continue
      if (fromDay && entry.day < fromDay) continue
      if (toDay && entry.day > toDay) continue
      if (!importsByDay.has(entry.day)) importsByDay.set(entry.day, [])
      importsByDay.get(entry.day).push(item)
    }
  }
  const days = [...importsByDay.keys()].sort()
  const snapshots = await Promise.all(
    days.map((day) => snapshotFromImport(day, pickFreshestImport(importsByDay.get(day)))),
  )
  return snapshots
}
