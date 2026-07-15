// Общие форматтеры для UI. Логика идентична прежним локальным копиям в компонентах.

/** Компактное число: 1.2M, 15K, 512. */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

/** Байты → человекочитаемо (Б/КБ/МБ/ГБ). */
export function formatBytes(b: number): string {
  if (b < 1024) return `${b} Б`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} КБ`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} МБ`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} ГБ`
}

/** Скорость (байт/с) → человекочитаемо. */
export function formatSpeed(bps: number): string {
  if (bps < 1024) return `${bps.toFixed(0)} Б/с`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} КБ/с`
  return `${(bps / 1024 / 1024).toFixed(1)} МБ/с`
}

/** Размер в МБ → «X МБ» / «Y.Z ГБ». */
export function formatSizeMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} ГБ`
  return `${mb.toFixed(0)} МБ`
}
