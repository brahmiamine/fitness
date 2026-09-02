export function rowsFromResult(result) {
  if (!result?.length) return []
  const [{ columns, values }] = result
  return values.map((valuesRow) =>
    Object.fromEntries(columns.map((column, index) => [column, valuesRow[index]])),
  )
}

export function query(database, sql, params = []) {
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

export function hasTable(tables, name) {
  const target = name.toLocaleLowerCase()
  return [...tables].some((table) => table.toLocaleLowerCase() === target)
}

export function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

export function actualTableName(tables, name) {
  const target = name.toLocaleLowerCase()
  return [...tables].find((table) => table.toLocaleLowerCase() === target) || name
}

export function number(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function string(value) {
  return value == null ? '' : String(value)
}
