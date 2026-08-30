export function average(values) {
  const valid = values.filter(Number.isFinite)
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0
}

export function median(values) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!valid.length) return 0
  const middle = Math.floor(valid.length / 2)
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2
}

export function percentile(values, ratio) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!valid.length) return 0
  const index = (valid.length - 1) * Math.max(0, Math.min(1, ratio))
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return valid[lower]
  return valid[lower] + (valid[upper] - valid[lower]) * (index - lower)
}

export function localDateKey(timestamp, timezoneSeconds = 0) {
  if (!Number.isFinite(timestamp)) return ''
  return new Date(timestamp + timezoneSeconds * 1000).toISOString().slice(0, 10)
}

export function localMinutes(timestamp, timezoneSeconds = 0) {
  const date = new Date(timestamp + timezoneSeconds * 1000)
  return date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60
}

export function formatDay(value) {
  if (!value) return 'Date inconnue'
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`))
}

export function formatShortDay(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`))
}

export function formatTime(timestamp, timezoneSeconds = 0) {
  if (!Number.isFinite(timestamp)) return '—'
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(new Date(timestamp + timezoneSeconds * 1000))
}

export function formatDateTime(timestamp, timezoneSeconds = 0) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '—'
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(new Date(timestamp + timezoneSeconds * 1000))
}

export function formatDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return '—'
  const rounded = Math.round(minutes)
  const hours = Math.floor(rounded / 60)
  const rest = rounded % 60
  if (!hours) return `${rest} min`
  return `${hours} h ${String(rest).padStart(2, '0')}`
}

export function formatNumber(value, maximumFractionDigits = 0) {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(value)
}

export function formatDistance(metres) {
  if (!Number.isFinite(metres)) return '—'
  if (metres < 1000) return `${Math.round(metres)} m`
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(metres / 1000)} km`
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 ** 2) return `${formatNumber(bytes / 1024, 1)} Ko`
  return `${formatNumber(bytes / 1024 ** 2, 1)} Mo`
}

export function downsample(points, target = 96) {
  if (points.length <= target) return points
  const size = points.length / target
  return Array.from({ length: target }, (_, index) => {
    const start = Math.floor(index * size)
    const end = Math.max(start + 1, Math.floor((index + 1) * size))
    const slice = points.slice(start, end)
    return {
      ...slice[Math.floor(slice.length / 2)],
      value: average(slice.map((point) => point.value)),
    }
  })
}
