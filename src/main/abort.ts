// Общий механизм отмены текущей операции (установка/запуск).
// Все наши axios-загрузки берут signal через opSignal().

let controller: AbortController | null = null

export function beginOperation(): void {
  controller = new AbortController()
}

export function cancelCurrent(): void {
  controller?.abort()
}

export function endOperation(): void {
  controller = null
}

export function opSignal(): AbortSignal | undefined {
  return controller?.signal
}

export function isCancelled(): boolean {
  return controller?.signal.aborted ?? false
}

export function isCancelError(e: unknown): boolean {
  if (!e) return false
  const name = (e as { name?: string }).name
  const code = (e as { code?: string }).code
  return name === 'CanceledError' || name === 'AbortError' || code === 'ERR_CANCELED'
}
