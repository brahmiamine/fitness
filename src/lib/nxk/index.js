import JSZip from 'jszip'
import initSqlJs from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { localDateKey, localMinutes } from '../format'
import { buildQualityReport } from '../quality'
import { parseAchievements } from '../achievements'
import { parseAppStats } from '../appStats'
import { buildDays } from './days'
import { summarizeGpsByDay } from './geo'
import { normalizeRecords, normalizeSleep, normalizeTimedRows } from './records'
import { fieldSummary, prepareCompatibleSchema, tableInventory, technicalSchemaCatalog } from './schema'
import { hasTable, number, query, rowsFromResult, string } from './sqlHelpers'

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
const MAX_DATABASE_BYTES = 512 * 1024 * 1024
const sqlReady = initSqlJs({ locateFile: () => sqlWasmUrl })

function sanitizeDeviceName(value) {
  return string(value || 'Bracelet connecté').replace(/\s+[0-9a-f]{4}$/i, '').trim()
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
  const obfuscatedArchiveEntry = Object.values(zip.files).find((entry) => /(^|\/)backup\.bak$/i.test(entry.name))
  const archiveTechnical = obfuscatedArchiveEntry
    ? {
        source: obfuscatedArchiveEntry.name,
        label: 'Configuration obfusquée de l’archive',
        count: 1,
        totalBytes: number(obfuscatedArchiveEntry?._data?.uncompressedSize),
        maximumBytes: number(obfuscatedArchiveEntry?._data?.uncompressedSize),
        storageType: 'fichier obfusqué',
        decoded: false,
        protected: true,
      }
    : null

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
    const appStatsRows = hasTable(tables, 'statsApp')
      ? query(database, 'SELECT name, type, notificationCounter, notificationTotalCounter FROM statsApp')
      : []
    const appStats = parseAppStats(appStatsRows)
    const achievementRows = hasTable(tables, 'appSetting')
      ? query(database, 'SELECT name, value FROM appSetting')
      : []
    const achievements = parseAchievements(achievementRows)
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
    const technical = {
      schema: technicalSchemaCatalog(database, tables, compatibility),
      obfuscatedFields: [
        archiveTechnical,
        fieldSummary(database, tables, 'profile', 'data', 'Profil interne du bracelet'),
        fieldSummary(database, tables, 'day', 'info', 'Informations quotidiennes obfusquées'),
        fieldSummary(database, tables, 'day', 'rawData', 'Données quotidiennes binaires'),
        fieldSummary(database, tables, 'sleep', 'info', 'Informations internes du sommeil'),
      ].filter(Boolean),
      policy: {
        valuesExtracted: false,
        secretsDisplayed: false,
        description: 'Seules la structure, le type et la taille sont exposés. Les contenus, jetons et identifiants restent masqués. Dans appSetting, seules les clés de succès débloqués (préfixe ach-) sont lues ; jetons et réglages internes ne sont jamais extraits.',
      },
    }

    const days = buildDays(dayRows, records, heart, spo2, stress, sleep, {
      workouts,
      gpsSummaries,
      weights,
      bloodPressure,
      bloodGlucose,
      notifications,
      battery,
    })
    if (!days.length) throw new Error('Aucune journée fitness exploitable n’a été trouvée.')

    const dataset = {
      schemaVersion: 5,
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
      gpsPrivate: gpsRows
        .filter((row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude) && Math.abs(row.latitude) <= 90 && Math.abs(row.longitude) <= 180)
        .map((row) => ({
          day: localDateKey(row.dateTime, row.tz),
          dateTime: row.dateTime,
          tz: row.tz,
          latitude: row.latitude,
          longitude: row.longitude,
          altitude: row.altitude,
          speed: row.speed,
          pause: row.pause,
        })),
      weights,
      bloodPressure,
      bloodGlucose,
      reminders,
      notifications,
      appStats,
      achievements,
      battery,
      statistics,
      technical,
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
    const quality = buildQualityReport(dataset)
    dataset.days = quality.days
    dataset.metadata.quality = {
      score: quality.score,
      level: quality.level,
      checks: quality.checks,
      summary: quality.summary,
    }
    return dataset
  } finally {
    database.close()
  }
}
