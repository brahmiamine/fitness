const DATABASE_NAME = 'pulse-nxk'
const IMPORT_STORE = 'imports'
const DAY_STORE = 'day-data'
const DATABASE_VERSION = 2

export const DAY_DATA_FIELDS = [
  'records',
  'heart',
  'spo2',
  'stress',
  'sleep',
  'sleepIntervals',
  'workouts',
  'gps',
  'weights',
  'bloodPressure',
  'bloodGlucose',
  'notifications',
  'battery',
]

const EMPTY_DAY_DATA = Object.fromEntries(DAY_DATA_FIELDS.map((field) => [field, []]))

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(IMPORT_STORE)) {
        const store = database.createObjectStore(IMPORT_STORE, { keyPath: 'id' })
        store.createIndex('importedAt', 'importedAt')
      }
      if (!database.objectStoreNames.contains(DAY_STORE)) {
        const store = database.createObjectStore(DAY_STORE, { keyPath: 'key' })
        store.createIndex('importId', 'importId')
        store.createIndex('importDay', ['importId', 'day'], { unique: true })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withTransaction(storeNames, mode, action) {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeNames, mode)
    let result
    let settled = false
    Promise.resolve(action(tx))
      .then((value) => { result = value })
      .catch((error) => {
        settled = true
        try { tx.abort() } catch { /* transaction may already be closed */ }
        database.close()
        reject(error)
      })
    tx.oncomplete = () => {
      database.close()
      if (!settled) resolve(result)
    }
    tx.onerror = () => {
      database.close()
      if (!settled) reject(tx.error)
    }
    tx.onabort = () => {
      database.close()
      if (!settled) reject(tx.error || new Error('La transaction locale a été annulée.'))
    }
  })
}

function aggregateNotifications(rows = []) {
  const byApp = new Map()
  for (const row of rows) {
    const current = byApp.get(row.appName) || { appName: row.appName, total: 0, filtered: 0 }
    current.total += Number(row.total) || 0
    current.filtered += Number(row.filtered) || 0
    byApp.set(row.appName, current)
  }
  return [...byApp.values()].sort((a, b) => b.total - a.total)
}

function buildManifest(item) {
  const manifest = { ...item }
  for (const field of DAY_DATA_FIELDS) delete manifest[field]
  let batteryMinimum = Number.POSITIVE_INFINITY
  let batteryMaximum = Number.NEGATIVE_INFINITY
  let batterySamples = 0
  for (const row of item.battery || []) {
    const value = Number(row.value)
    if (!Number.isFinite(value)) continue
    batteryMinimum = Math.min(batteryMinimum, value)
    batteryMaximum = Math.max(batteryMaximum, value)
    batterySamples += 1
  }
  const domainCounts = Object.fromEntries(DAY_DATA_FIELDS.map((field) => [field, (item[field] || []).length]))
  manifest.schemaVersion = Math.max(3, Number(item.schemaVersion) || 0)
  manifest.storageMode = 'day-partitioned'
  manifest.metadata = {
    ...item.metadata,
    coverage: {
      firstDay: item.days.at(-1)?.day || '',
      lastDay: item.days[0]?.day || '',
      dayCount: item.days.length,
    },
    domainCounts,
    notificationApps: aggregateNotifications(item.notifications),
    batteryRange: batterySamples
      ? { minimum: batteryMinimum, maximum: batteryMaximum, samples: batterySamples }
      : null,
  }
  return manifest
}

function buildDayChunks(item) {
  const chunks = new Map()
  for (const field of DAY_DATA_FIELDS) {
    for (const row of item[field] || []) {
      if (!row.day) continue
      const key = `${item.id}::${row.day}`
      if (!chunks.has(key)) {
        chunks.set(key, { key, importId: item.id, day: row.day, ...structuredClone(EMPTY_DAY_DATA) })
      }
      chunks.get(key)[field].push(row)
    }
  }
  return [...chunks.values()]
}

export function partitionImport(item) {
  return { manifest: buildManifest(item), chunks: buildDayChunks(item) }
}

function deleteChunks(store, importId, onComplete = () => {}) {
  const request = store.index('importId').openKeyCursor(IDBKeyRange.only(importId))
  request.onsuccess = () => {
    const cursor = request.result
    if (!cursor) {
      onComplete()
      return
    }
    store.delete(cursor.primaryKey)
    cursor.continue()
  }
}

export async function prepareStorage(archiveBytes) {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return
  navigator.storage.persist?.().catch(() => false)
  const estimate = await navigator.storage.estimate()
  const remaining = (estimate.quota || 0) - (estimate.usage || 0)
  const conservativeNeed = Math.max(archiveBytes * 3, 25 * 1024 * 1024)
  if (estimate.quota && remaining < conservativeNeed) {
    throw new Error('Espace local insuffisant pour importer cette sauvegarde. Libérez de l’espace dans le navigateur puis réessayez.')
  }
}

export async function listImports() {
  const items = await withTransaction([IMPORT_STORE], 'readonly', (tx) =>
    requestResult(tx.objectStore(IMPORT_STORE).getAll()),
  )
  return items.sort((a, b) => b.importedAt.localeCompare(a.importedAt))
}

export async function loadImportDay(item, day) {
  if (!item || item.storageMode !== 'day-partitioned') return item
  const chunk = await withTransaction([DAY_STORE], 'readonly', (tx) =>
    requestResult(tx.objectStore(DAY_STORE).get(`${item.id}::${day}`)),
  )
  return {
    ...item,
    ...structuredClone(EMPTY_DAY_DATA),
    ...(chunk || {}),
    id: item.id,
    day,
  }
}

export async function saveImport(item) {
  const { manifest, chunks } = partitionImport(item)
  await withTransaction([IMPORT_STORE, DAY_STORE], 'readwrite', (tx) => {
    const importStore = tx.objectStore(IMPORT_STORE)
    const dayStore = tx.objectStore(DAY_STORE)
    deleteChunks(dayStore, item.id, () => {
      importStore.put(manifest)
      for (const chunk of chunks) dayStore.put(chunk)
    })
  })
  return manifest
}

export function deleteImport(id) {
  return withTransaction([IMPORT_STORE, DAY_STORE], 'readwrite', (tx) => {
    tx.objectStore(IMPORT_STORE).delete(id)
    deleteChunks(tx.objectStore(DAY_STORE), id)
  })
}

export function clearImports() {
  return withTransaction([IMPORT_STORE, DAY_STORE], 'readwrite', (tx) => {
    tx.objectStore(IMPORT_STORE).clear()
    tx.objectStore(DAY_STORE).clear()
  })
}
