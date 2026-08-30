import JSZip from 'jszip'
import initSqlJs from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { average, localDateKey, localMinutes } from './format'

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
const MAX_DATABASE_BYTES = 100 * 1024 * 1024
const sqlReady = initSqlJs({ locateFile: () => sqlWasmUrl })

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
  return tables.has(name)
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
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
    maximumSpeed: Math.max(...rows.map((row) => row.speed)) * 3.6,
    minimumAltitude: Math.min(...rows.map((row) => row.altitude)),
    maximumAltitude: Math.max(...rows.map((row) => row.altitude)),
    pausedSamples: rows.filter((row) => row.pause).length,
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

function buildDays(dayRows, records, heart, spo2, stress, sleep) {
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

  const allKeys = new Set([
    ...records.map((row) => row.day),
    ...heart.map((row) => row.day),
    ...spo2.map((row) => row.day),
    ...stress.map((row) => row.day),
    ...sleep.map((row) => row.day),
  ])
  for (const day of allKeys) {
    if (!day) continue
    const dailyRecords = records.filter((row) => row.day === day)
    const existing = byDay.get(day) ?? { day }
    const recordSteps = dailyRecords.reduce((sum, row) => sum + row.steps, 0)
    const recordCalories = dailyRecords.reduce((sum, row) => sum + row.calories, 0)
    const recordDistance = dailyRecords.reduce((sum, row) => sum + row.distance, 0)
    const heartValues = heart.filter((row) => row.day === day && row.type === 0).map((row) => row.value)
    const oxygenValues = spo2.filter((row) => row.day === day).map((row) => row.value)
    const stressValues = stress.filter((row) => row.day === day).map((row) => row.value)
    byDay.set(day, {
      ...existing,
      steps: existing.steps || recordSteps,
      calories: existing.calories || recordCalories,
      distance: existing.distance || recordDistance,
      heartAverage: existing.heartAverage || average(heartValues),
      spo2Average: existing.spo2Average || average(oxygenValues),
      stressAverage: existing.stressAverage || average(stressValues),
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
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error('Le fichier dépasse la limite de 50 Mo.')
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
  if (databaseBytes.byteLength > MAX_DATABASE_BYTES) throw new Error('La base extraite dépasse la limite de 100 Mo.')
  const signature = new TextDecoder().decode(databaseBytes.slice(0, 15))
  if (signature !== 'SQLite format 3') throw new Error('La base de données NXK n’est pas valide.')

  const SQL = await sqlReady
  const database = new SQL.Database(databaseBytes)
  try {
    const tables = new Set(
      rowsFromResult(database.exec("SELECT name FROM sqlite_master WHERE type='table'"))
        .map((row) => row.name),
    )
    if (!hasTable(tables, 'day') && !hasTable(tables, 'record')) {
      throw new Error('Cette sauvegarde NXK utilise une structure non reconnue.')
    }

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

    const days = buildDays(dayRows, records, heart, spo2, stress, sleep)
    if (!days.length) throw new Error('Aucune journée fitness exploitable n’a été trouvée.')

    return {
      schemaVersion: 2,
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
      gps: summarizeGpsByDay(gpsRows),
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
      },
    }
  } finally {
    database.close()
  }
}
