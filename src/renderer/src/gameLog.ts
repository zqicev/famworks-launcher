// Логи игры, привязанные к сборке. Буфер на каждую сборку; вкладка «Логи» читает по своему id.

export type LogLevel = 'error' | 'warn' | 'info'
export interface LogLine { id: number; text: string; level: LogLevel }

const MAX = 2500 // держим хвост на сборку, старое отбрасываем

const buffers = new Map<string, LogLine[]>()
let seq = 0
let version = 0
let started = false
let notifyScheduled = false
const subs = new Set<() => void>()

function classify(text: string): LogLevel {
  if (/\/(ERROR|SEVERE|FATAL)\]/.test(text) || /Exception|Caused by:|^\s+at\s/.test(text)) return 'error'
  if (/\/WARN(ING)?\]|\bWARN(ING)?\b/.test(text)) return 'warn'
  return 'info'
}

function bump(): void {
  version++
  subs.forEach(f => f())
}

function scheduleNotify(): void {
  if (notifyScheduled) return
  notifyScheduled = true
  setTimeout(() => { notifyScheduled = false; bump() }, 120) // троттлим при потоке логов
}

function getBuf(id: string): LogLine[] {
  let b = buffers.get(id)
  if (!b) { b = []; buffers.set(id, b) }
  return b
}

function pushLog(id: string, chunk: string): void {
  const b = getBuf(id)
  for (const p of String(chunk).split(/\r?\n/)) {
    if (p.length) b.push({ id: seq++, text: p, level: classify(p) })
  }
  if (b.length > MAX) buffers.set(id, b.slice(-MAX))
  scheduleNotify()
}

/** Запускает захват логов один раз на всё приложение (вызывать при старте App). */
export function ensureLogCapture(): void {
  if (started) return
  started = true
  window.api.launch.onLog(({ id, text }) => { if (id) pushLog(id, text) })
  window.api.launch.onSpawned((id: string) => { buffers.set(id, []); bump() }) // новый запуск сборки — её лог с чистого
}

export function clearLog(id: string): void { buffers.set(id, []); bump() }
export function getLogLines(id: string): LogLine[] { return buffers.get(id) ?? [] }
export function getLogVersion(): number { return version }
export function subscribeLog(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb) } }
