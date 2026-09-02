import { actualTableName, hasTable, number, query, quoteIdentifier, string } from './sqlHelpers'

export const EXPECTED_COLUMNS = {
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
  statsApp: ['name', 'type', 'notificationCounter', 'notificationTotalCounter'],
  statsLogs: ['dateTime', 'tz', 'appName', 'batteryLevel'],
  stress: ['dateTime', 'tz', 'value', 'type'],
  syncRecord: ['dateTime'],
  weight: ['dateTime', 'tz', 'value'],
  workout: ['startDateTime', 'endDateTime', 'tz', 'type', 'heartAvg', 'spo2Avg', 'duration', 'steps', 'title', 'calories', 'distance', 'pause'],
}

export function prepareCompatibleSchema(database, tables) {
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

export function tableInventory(database, tables) {
  return [...tables]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      rows: number(query(database, `SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`)[0]?.count),
    }))
}

export function technicalSchemaCatalog(database, tables, compatibility) {
  const adapted = new Set(compatibility.addedColumns)
  return [...tables].sort((a, b) => a.localeCompare(b)).map((table) => ({
    table,
    columns: query(database, `PRAGMA table_info(${quoteIdentifier(table)})`).map((column) => ({
      name: string(column.name),
      type: string(column.type || 'non déclaré'),
      nullable: !Boolean(column.notnull),
      primaryKey: Boolean(column.pk),
      adapted: adapted.has(`${table}.${column.name}`),
      protected: /token|secret|password|passwd|mac|setting|raw|info|data/i.test(string(column.name)) || table === 'appSetting',
    })),
  }))
}

export function fieldSummary(database, tables, table, column, label) {
  if (!hasTable(tables, table)) return null
  const tableName = actualTableName(tables, table)
  const columns = query(database, `PRAGMA table_info(${quoteIdentifier(tableName)})`)
  const actualColumn = columns.find((item) => string(item.name).toLocaleLowerCase() === column.toLocaleLowerCase())?.name
  if (!actualColumn) return null
  const [summary] = query(
    database,
    `SELECT COUNT(${quoteIdentifier(actualColumn)}) AS count, COALESCE(SUM(length(${quoteIdentifier(actualColumn)})), 0) AS totalBytes, COALESCE(MAX(length(${quoteIdentifier(actualColumn)})), 0) AS maximumBytes, typeof(${quoteIdentifier(actualColumn)}) AS storageType FROM ${quoteIdentifier(tableName)}`,
  )
  return {
    source: `${tableName}.${actualColumn}`,
    label,
    count: number(summary?.count),
    totalBytes: number(summary?.totalBytes),
    maximumBytes: number(summary?.maximumBytes),
    storageType: string(summary?.storageType || 'inconnu'),
    decoded: false,
    protected: true,
  }
}
