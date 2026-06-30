// Какая сборка сейчас занята (устанавливается/запускается/запущена).
// Пока занята одна — действия с другими блокируются.

let busyId: string | null = null
let listener: ((id: string | null) => void) | null = null

export function setBusy(id: string | null): void {
  busyId = id
  listener?.(id)
}
export function getBusyId(): string | null {
  return busyId
}
export function onBusyChange(fn: (id: string | null) => void): void {
  listener = fn
}
