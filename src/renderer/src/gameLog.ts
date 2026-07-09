// Глобальный стор логов запущенной игры. Одновременно работает одна сборка (busy-lock),
// поэтому лог общий; вкладка «Логи» читает его через useSyncExternalStore.

export type LogLevel = 'error' | 'warn' | 'info'
export interface LogLine { id: number; text: string; level: LogLevel }

const MAX = 2500 // держим хвост, старое отбрасываем

let lines: LogLine[] = []
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

function scheduleNotify(): void {
  if (notifyScheduled) return
  notifyScheduled = true
  // троттлим: при потоке логов не дёргаем React чаще ~8 раз/сек
  setTimeout(() => { notifyScheduled = false; version++; subs.forEach(f => f()) }, 120)
}

function reset(): void {
  lines = []
  seq = 0
  version++
  subs.forEach(f => f())
}

function pushChunk(chunk: string): void {
  for (const p of String(chunk).split(/\r?\n/)) {
    if (!p.length) continue
    lines.push({ id: seq++, text: p, level: classify(p) })
  }
  if (lines.length > MAX) lines = lines.slice(-MAX)
  scheduleNotify()
}

/** Запускает захват логов игры один раз на всё приложение (вызывать при старте App). */
export function ensureLogCapture(): void {
  if (started) return
  started = true
  window.api.launch.onLog((c: string) => pushChunk(c))
  window.api.launch.onSpawned(() => reset()) // новый запуск — начинаем с чистого
}

export function clearLog(): void { reset() }
export function getLogLines(): LogLine[] { return lines }
export function getLogVersion(): number { return version }
export function subscribeLog(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb) } }
