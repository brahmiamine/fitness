import JSZip from 'jszip'
import initSqlJs from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { localDateKey, localMinutes } from './format'

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
const MAX_DATABASE_BYTES = 512 * 1024 * 1024
const sqlReady = initSqlJs({ locateFile: () => sqlWasmUrl })

const EXPECTED_COLUMNS = {
  DailyAppStats: ['dayKey', 'appName', 'totalCount', 'filteredCount'],
  blood_glucose: ['dateTime', 'tz', 'valueMgDl', 'displayUnit', 'mealRelation', 'mealType', 'mealOffsetMinutes', 'sampleSource', 'carbohydratesGrams', 'insulinUnits', 'insulinType', 'medicationTiming', 'recentExercise', 'deviceName', 'notes'],
  blood_pressure: ['dateTime', 'tz', 'systolic', 'diastolic', 'heartRate', 'position', 'measurementSite', 'context', 'medicationTiming', 'irregularHeartbeat', 'deviceName', 'notes'],
  day: ['day', 'steps', 'calories', 'activeMinutes', 'intensiveMinutes', 'pai', 'paiEarned', 'distance', 'hr', 'spo2', 'stress'],
  gps: ['dateTime', 'tz', 'latitude', 'longitude', 'altitude', 'speed', 'pause'],
  health_reminder: ['measurementType', 'label', 'hour', 'minute', 'daysMask', 'enabled', 'defaultContext', 'snoozeMinutes'],
  heart: ['dateTime', 'tz', 'value', 'type'],
  profile: ['watchName', 'watchType', 'active'],
  record: ['dateTime', 'tz', 'type', 'steps', 'calories', 'activityType', 'distance', 'hr', 'spo2', 'stress', 'energy'],
  sleep: ['start', 'end', 'tz', 'day', 'light', 'deep', 'rem', 'awake', 'total', 'turnOver', 'hrAvg', 'spo2Avg', 'userModified'],
  sleepIntervals: ['start', 'end', 'tz', 'type', 'hrAvg'],
  spo2: ['dateTime', 'tz', 'value', 'type'],
  stats: ['statName', 'periodStart', 'periodEnd', 'totalNotifications', 'uniqueNotifications', 'totalVibrationsLength', 'totalVibrations', 'totalWatchfaces', 'uniqueWatchfaces', 'batteryLevelStart', 'batteryLevelEnd'],
  statsLogs: ['dateTime', 'tz', 'appName', 'batteryLevel'],
  stress: ['dateTime', 'tz', 'value', 'type'],
  syncRecord: ['dateTime'],
  weight: ['dateTime', 'tz', 'value'],
  workout: ['startDateTime', 'endDateTime', 'tz', 'type', 'heartAvg', 'spo2Avg', 'duration', 'steps', 'title', 'calories', 'distance', 'pause'],
}

function rowsFromResult(result) {
  if (!result?.length) return []
  const [{ columns, values }] = result
  return values.map((valuesRow) =>
    Object.fromEntries(columns.map((column, index) => [column, valuesRow[index]])),
  )
}

function query(database, sql, params = []) {
  const statement = database.prepare(sql)
  try {
    statement.bind(params)
    const rows = []
    while (statement.step()) rows.push(statement.getAsObject())
    return rows
  } finally {
    statement.free()
  }
}

function hasTable(tables, name) {
  const target = name.toLocaleLowerCase()
  return [...tables].some((table) => table.toLocaleLowerCase() === target)
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

function actualTableName(tables, name) {
  const target = name.toLocaleLowerCase()
  return [...tables].find((table) => table.toLocaleLowerCase() === target) || name
}

function prepareCompatibleSchema(database, tables) {
  const addedColumns = []
  const knownTables = new Set(Object.keys(EXPECTED_COLUMNS).map((name) => name.toLocaleLowerCase()))
  const unknownTables = [...tables].filter((name) => !knownTables.has(name.toLocaleLowerCase()))
  const unknownColumns = []

  for (const [logicalName, expectedColumns] of Object.entries(EXPECTED_COLUMNS)) {
    if (!hasTable(tables, logicalName)) continue
    const tableName = actualTableName(tables, logicalName)
    const existing = query(database, `PRAGMA table_info(${quoteIdentifier(tableName)})`)
    const byLowerName = new Set(existing.map((column) => string(column.name).toLocaleLowerCase()))
    const expectedLowerNames = new Set(expectedColumns.map((column) => column.toLocaleLowerCase()))

    for (const column of existing) {
      if (!expectedLowerNames.has(string(column.name).toLocaleLowerCase())) {
        unknownColumns.push(`${tableName}.${column.name}`)
      }
    }

    for (const column of expectedColumns) {
      if (byLowerName.has(column.toLocaleLowerCase())) continue
      database.run(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(column)}`)
      addedColumns.push(`${tableName}.${column}`)
    }
  }

  return { addedColumns, unknownTables, unknownColumns }
}

function tableInventory(database, tables) {
  return [...tables]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      rows: number(query(database, `SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`)[0]?.count),
    }))
}

function number(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function string(value) {
  return value == null ? '' : String(value)
}

function sanitizeDeviceName(value) {
  return string(value || 'Bracelet connecté').replace(/\s+[0-9a-f]{4}$/i, '').trim()
}

function normalizeTimedRows(rows) {
  return rows
    .map((row) => ({
      ...row,
      dateTime: number(row.dateTime),
      tz: number(row.tz),
      value: number(row.value),
      type: number(row.type),
      day: localDateKey(number(row.dateTime), number(row.tz)),
    }))
    .filter((row) => row.dateTime > 0)
}

function haversineDistance(first, second) {
  const radians = (value) => (value * Math.PI) / 180
  const earthRadius = 6_371_000
  const lat1 = radians(first.latitude)
  const lat2 = radians(second.latitude)
  const deltaLat = lat2 - lat1
  const deltaLng = radians(second.longitude - first.longitude)
  const value =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

function summarizeGps(rows) {
  if (!rows.length) return null
  let distance = 0
  let maximumSpeed = 0
  let minimumAltitude = Number.POSITIVE_INFINITY
  let maximumAltitude = Number.NEGATIVE_INFINITY
  let pausedSamples = 0
  for (const row of rows) {
    maximumSpeed = Math.max(maximumSpeed, row.speed)
    minimumAltitude = Math.min(minimumAltitude, row.altitude)
    maximumAltitude = Math.max(maximumAltitude, row.altitude)
    if (row.pause) pausedSamples += 1
  }
  for (let index = 1; index < rows.length; index += 1) {
    const segment = haversineDistance(rows[index - 1], rows[index])
    if (segment < 100) distance += segment
  }
  const start = rows[0]
  const end = rows.at(-1)
  const durationMinutes = Math.max(0, (end.dateTime - start.dateTime) / 60_000)
  return {
    day: localDateKey(start.dateTime, start.tz),
    sampleCount: rows.length,
    start: start.dateTime,
    end: end.dateTime,
    timezone: start.tz,
    durationMinutes,
    distance,
    averageSpeed: durationMinutes ? (distance / (durationMinutes * 60)) * 3.6 : 0,
    maximumSpeed: maximumSpeed * 3.6,
    minimumAltitude,
    maximumAltitude,
    pausedSamples,
  }
}

function summarizeGpsByDay(rows) {
  const byDay = new Map()
  for (const row of rows) {
    const day = localDateKey(row.dateTime, row.tz)
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day).push(row)
  }
  return [...byDay.values()].map(summarizeGps).filter(Boolean)
}

function normalizeSleep(rows) {
  return rows.map((row) => {
    const light = number(row.light)
    const deep = number(row.deep)
    const rem = number(row.rem)
    const awake = number(row.awake)
    const asleep = light + deep + rem
    return {
      start: number(row.start),
      end: number(row.end),
      tz: number(row.tz),
      day: row.day || localDateKey(number(row.end), number(row.tz)),
      light,
      deep,
      rem,
      awake,
      total: number(row.total, asleep + awake),
      asleep,
      heartAverage: number(row.hrAvg),
      spo2Average: number(row.spo2Avg),
      modified: Boolean(row.userModified),
      turnOvers: number(row.turnOver),
    }
  })
}

function normalizeRecords(rows) {
  return rows.map((row) => ({
    dateTime: number(row.dateTime),
    tz: number(row.tz),
    day: localDateKey(number(row.dateTime), number(row.tz)),
    type: number(row.type),
    steps: number(row.steps),
    calories: number(row.calories),
    activityType: number(row.activityType),
    distance: number(row.distance),
    heartRate: number(row.hr),
    spo2: number(row.spo2),
    stress: number(row.stress),
    energy: number(row.energy),
  }))
}

function buildDays(dayRows, records, heart, spo2, stress, sleep, additionalCollections = []) {
  const byDay = new Map()
  for (const row of dayRows) {
    byDay.set(row.day, {
      day: row.day,
      steps: number(row.steps),
      calories: number(row.calories),
      activeMinutes: number(row.activeMinutes),
      intensiveMinutes: number(row.intensiveMinutes),
      pai: number(row.pai),
      paiEarned: number(row.paiEarned),
      distance: number(row.distance),
      heartAverage: number(row.hr),
      spo2Average: number(row.spo2),
      stressAverage: number(row.stress),
    })
  }

  const aggregates = new Map()
  const aggregateFor = (day) => {
    if (!day) return null
    if (!aggregates.has(day)) {
      aggregates.set(day, {
        steps: 0,
        calories: 0,
        distance: 0,
        heartSum: 0,
        heartCount: 0,
        spo2Sum: 0,
        spo2Count: 0,
        stressSum: 0,
        stressCount: 0,
      })
    }
    return aggregates.get(day)
  }
  for (const row of records) {
    const aggregate = aggregateFor(row.day)
    if (!aggregate) continue
    aggregate.steps += row.steps
    aggregate.calories += row.calories
    aggregate.distance += row.distance
  }
  for (const row of heart) {
    const aggregate = aggregateFor(row.day)
    if (aggregate && row.type === 0) {
      aggregate.heartSum += row.value
      aggregate.heartCount += 1
    }
  }
  for (const row of spo2) {
    const aggregate = aggregateFor(row.day)
    if (aggregate) {
      aggregate.spo2Sum += row.value
      aggregate.spo2Count += 1
    }
  }
  for (const row of stress) {
    const aggregate = aggregateFor(row.day)
    if (aggregate) {
      aggregate.stressSum += row.value
      aggregate.stressCount += 1
    }
  }
  for (const row of sleep) aggregateFor(row.day)
  for (const collection of additionalCollections) {
    for (const row of collection) aggregateFor(row.day)
  }

  for (const [day, aggregate] of aggregates) {
    if (!day) continue
    const existing = byDay.get(day) ?? { day }
    byDay.set(day, {
      ...existing,
      steps: existing.steps || aggregate.steps,
      calories: existing.calories || aggregate.calories,
      distance: existing.distance || aggregate.distance,
      heartAverage: existing.heartAverage || (aggregate.heartCount ? aggregate.heartSum / aggregate.heartCount : 0),
      spo2Average: existing.spo2Average || (aggregate.spo2Count ? aggregate.spo2Sum / aggregate.spo2Count : 0),
      stressAverage: existing.stressAverage || (aggregate.stressCount ? aggregate.stressSum / aggregate.stressCount : 0),
    })
  }
  return [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day))
}

async function fingerprint(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function parseNxk(file, onProgress = () => {}) {
  if (!file) throw new Error('Sélectionnez une sauvegarde NXK.')
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error('Le fichier dépasse la limite de sécurité de 256 Mo pour un traitement local.')
  if (!/\.(nxk|zip)$/i.test(file.name)) throw new Error('Ce fichier ne porte pas l’extension .nxk.')

  onProgress('Lecture de la sauvegarde…')
  const fileBuffer = await file.arrayBuffer()
  let id
  let zip
  try {
    ;[id, zip] = await Promise.all([fingerprint(fileBuffer), JSZip.loadAsync(fileBuffer)])
  } catch {
    throw new Error('Le fichier NXK est illisible ou l’archive est endommagée.')
  }
  const databaseEntry = Object.values(zip.files).find((entry) => /(^|\/)backup\.db$/i.test(entry.name))
  if (!databaseEntry) throw new Error('La sauvegarde ne contient pas de base backup.db.')

  onProgress('Ouverture de la base locale…')
  const databaseBytes = await databaseEntry.async('uint8array')
  if (databaseBytes.byteLength > MAX_DATABASE_BYTES) throw new Error('La base extraite dépasse la limite de sécurité de 512 Mo.')
  const signature = new TextDecoder().decode(databaseBytes.slice(0, 15))
  if (signature !== 'SQLite format 3') throw new Error('La base de données NXK n’est pas valide.')

  const SQL = await sqlReady
  const database = new SQL.Database(databaseBytes)
  try {
    const tables = new Set(
      rowsFromResult(database.exec("SELECT name FROM sqlite_master WHERE type='table'"))
        .map((row) => row.name),
    )
    const supportedTables = ['day', 'record', 'heart', 'sleep', 'spo2', 'stress', 'workout', 'weight', 'blood_pressure', 'blood_glucose', 'gps']
    if (!supportedTables.some((name) => hasTable(tables, name))) {
      throw new Error('Cette sauvegarde NXK utilise une structure non reconnue.')
    }
    const compatibility = prepareCompatibleSchema(database, tables)

    onProgress('Analyse des mesures…')
    const dayRows = hasTable(tables, 'day')
      ? query(database, 'SELECT day, steps, calories, activeMinutes, intensiveMinutes, pai, paiEarned, distance, hr, spo2, stress FROM day ORDER BY day DESC')
      : []
    const records = hasTable(tables, 'record')
      ? normalizeRecords(
          query(database, 'SELECT dateTime, tz, type, steps, calories, activityType, distance, hr, spo2, stress, energy FROM record ORDER BY dateTime'),
        )
      : []
    const heart = hasTable(tables, 'heart')
      ? normalizeTimedRows(query(database, 'SELECT dateTime, tz, value, type FROM heart WHERE value > 0 ORDER BY dateTime'))
      : []
    const spo2 = hasTable(tables, 'spo2')
      ? normalizeTimedRows(query(database, 'SELECT dateTime, tz, value, type FROM spo2 WHERE value > 0 ORDER BY dateTime'))
      : []
    const stress = hasTable(tables, 'stress')
      ? normalizeTimedRows(query(database, 'SELECT dateTime, tz, value, type FROM stress WHERE value > 0 ORDER BY dateTime'))
      : []
    const sleep = hasTable(tables, 'sleep')
      ? normalizeSleep(
          query(database, 'SELECT start, end, tz, day, light, deep, rem, awake, total, turnOver, hrAvg, spo2Avg, userModified FROM sleep ORDER BY start'),
        )
      : []
    const sleepIntervals = hasTable(tables, 'sleepIntervals')
      ? query(database, 'SELECT start, end, tz, type, hrAvg FROM sleepIntervals ORDER BY start').map((row) => ({
          start: number(row.start),
          end: number(row.end),
          tz: number(row.tz),
          type: number(row.type),
          heartAverage: number(row.hrAvg),
          day: localDateKey(number(row.end), number(row.tz)),
        }))
      : []
    const gpsRows = hasTable(tables, 'gps')
      ? query(database, 'SELECT dateTime, tz, latitude, longitude, altitude, speed, pause FROM gps ORDER BY dateTime').map((row) => ({
          dateTime: number(row.dateTime),
          tz: number(row.tz),
          latitude: number(row.latitude),
          longitude: number(row.longitude),
          altitude: number(row.altitude),
          speed: number(row.speed),
          pause: Boolean(row.pause),
        }))
      : []
    const profile = hasTable(tables, 'profile')
      ? query(database, 'SELECT watchName, watchType FROM profile WHERE active = 1 LIMIT 1')[0]
        || query(database, 'SELECT watchName, watchType FROM profile LIMIT 1')[0]
      : null
    const workouts = hasTable(tables, 'workout')
      ? query(database, 'SELECT startDateTime, endDateTime, tz, type, heartAvg, spo2Avg, duration, steps, title, calories, distance, pause FROM workout ORDER BY startDateTime DESC').map((row) => ({
          start: number(row.startDateTime),
          end: number(row.endDateTime),
          tz: number(row.tz),
          type: number(row.type),
          heartAverage: number(row.heartAvg),
          spo2Average: number(row.spo2Avg),
          duration: number(row.duration),
          steps: number(row.steps),
          title: String(row.title || ''),
          calories: number(row.calories),
          distance: number(row.distance),
          pause: number(row.pause),
          day: localDateKey(number(row.startDateTime), number(row.tz)),
        }))
      : []
    const weights = hasTable(tables, 'weight')
      ? query(database, 'SELECT dateTime, tz, value FROM weight ORDER BY dateTime').map((row) => ({
          dateTime: number(row.dateTime),
          tz: number(row.tz),
          value: number(row.value),
          day: localDateKey(number(row.dateTime), number(row.tz)),
        }))
      : []
    const bloodPressure = hasTable(tables, 'blood_pressure')
      ? query(database, 'SELECT dateTime, tz, systolic, diastolic, heartRate, position, measurementSite, context, medicationTiming, irregularHeartbeat, deviceName, notes FROM blood_pressure ORDER BY dateTime').map((row) => ({
          dateTime: number(row.dateTime),
          tz: number(row.tz),
          systolic: number(row.systolic),
          diastolic: number(row.diastolic),
          heartRate: number(row.heartRate),
          position: number(row.position),
          measurementSite: number(row.measurementSite),
          context: number(row.context),
          medicationTiming: number(row.medicationTiming),
          irregularHeartbeat: Boolean(row.irregularHeartbeat),
          deviceName: string(row.deviceName),
          notes: string(row.notes),
          day: localDateKey(number(row.dateTime), number(row.tz)),
        }))
      : []
    const bloodGlucose = hasTable(tables, 'blood_glucose')
      ? query(database, 'SELECT dateTime, tz, valueMgDl, displayUnit, mealRelation, mealType, mealOffsetMinutes, sampleSource, carbohydratesGrams, insulinUnits, insulinType, medicationTiming, recentExercise, deviceName, notes FROM blood_glucose ORDER BY dateTime').map((row) => ({
          dateTime: number(row.dateTime),
          tz: number(row.tz),
          valueMgDl: number(row.valueMgDl),
          displayUnit: number(row.displayUnit),
          mealRelation: number(row.mealRelation),
          mealType: number(row.mealType),
          mealOffsetMinutes: number(row.mealOffsetMinutes),
          sampleSource: number(row.sampleSource),
          carbohydratesGrams: number(row.carbohydratesGrams),
          insulinUnits: number(row.insulinUnits),
          insulinType: string(row.insulinType),
          medicationTiming: number(row.medicationTiming),
          recentExercise: number(row.recentExercise),
          deviceName: string(row.deviceName),
          notes: string(row.notes),
          day: localDateKey(number(row.dateTime), number(row.tz)),
        }))
      : []
    const reminders = hasTable(tables, 'health_reminder')
      ? query(database, 'SELECT measurementType, label, hour, minute, daysMask, enabled, defaultContext, snoozeMinutes FROM health_reminder ORDER BY hour, minute').map((row) => ({
          measurementType: number(row.measurementType),
          label: string(row.label),
          hour: number(row.hour),
          minute: number(row.minute),
          daysMask: number(row.daysMask),
          enabled: Boolean(row.enabled),
          defaultContext: number(row.defaultContext),
          snoozeMinutes: number(row.snoozeMinutes),
        }))
      : []
    const notifications = hasTable(tables, 'DailyAppStats')
      ? query(database, 'SELECT dayKey, appName, totalCount, filteredCount FROM DailyAppStats ORDER BY dayKey, totalCount DESC').map((row) => ({
          dateTime: number(row.dayKey),
          day: localDateKey(number(row.dayKey), 0),
          appName: string(row.appName),
          total: number(row.totalCount),
          filtered: number(row.filteredCount),
        }))
      : []
    const battery = hasTable(tables, 'statsLogs')
      ? query(database, "SELECT dateTime, tz, batteryLevel FROM statsLogs WHERE appName = 'battery' AND batteryLevel > 0 ORDER BY dateTime").map((row) => ({
          dateTime: number(row.dateTime),
          tz: number(row.tz),
          value: number(row.batteryLevel),
          day: localDateKey(number(row.dateTime), number(row.tz)),
        }))
      : []
    const statistics = hasTable(tables, 'stats')
      ? query(database, 'SELECT statName, periodStart, periodEnd, totalNotifications, uniqueNotifications, totalVibrationsLength, totalVibrations, totalWatchfaces, uniqueWatchfaces, batteryLevelStart, batteryLevelEnd FROM stats').map((row) => ({
          name: string(row.statName),
          start: number(row.periodStart),
          end: number(row.periodEnd),
          totalNotifications: number(row.totalNotifications),
          uniqueNotifications: number(row.uniqueNotifications),
          vibrationDuration: number(row.totalVibrationsLength),
          vibrations: number(row.totalVibrations),
          watchfaces: number(row.totalWatchfaces),
          uniqueWatchfaces: number(row.uniqueWatchfaces),
          batteryStart: number(row.batteryLevelStart),
          batteryEnd: number(row.batteryLevelEnd),
        }))
      : []
    const syncRows = hasTable(tables, 'syncRecord')
      ? query(database, 'SELECT dateTime FROM syncRecord ORDER BY dateTime').map((row) => number(row.dateTime)).filter(Boolean)
      : []
    const inventory = tableInventory(database, tables)
    const gpsSummaries = summarizeGpsByDay(gpsRows)

    const days = buildDays(dayRows, records, heart, spo2, stress, sleep, [
      workouts,
      gpsSummaries,
      weights,
      bloodPressure,
      bloodGlucose,
      notifications,
      battery,
    ])
    if (!days.length) throw new Error('Aucune journée fitness exploitable n’a été trouvée.')

    return {
      schemaVersion: 3,
      id,
      fileName: file.name,
      fileSize: file.size,
      importedAt: new Date().toISOString(),
      device: profile
        ? { name: sanitizeDeviceName(profile.watchName), type: number(profile.watchType) }
        : null,
      days,
      records,
      heart,
      spo2,
      stress,
      sleep,
      sleepIntervals,
      workouts,
      gps: gpsSummaries,
      weights,
      bloodPressure,
      bloodGlucose,
      reminders,
      notifications,
      battery,
      statistics,
      metadata: {
        tableCount: tables.size,
        recordCount: records.length + heart.length + spo2.length + stress.length,
        firstMinute: records.length ? localMinutes(records[0].dateTime, records[0].tz) : null,
        inventory,
        totalRows: inventory.reduce((sum, table) => sum + table.rows, 0),
        gpsPointsDiscarded: gpsRows.length,
        syncCount: syncRows.length,
        firstSync: syncRows[0] || 0,
        lastSync: syncRows.at(-1) || 0,
        protectedFields: ['coordonnées GPS brutes', 'adresse MAC', 'jetons et paramètres secrets'],
        compatibility,
      },
    }
  } finally {
    database.close()
  }
}
