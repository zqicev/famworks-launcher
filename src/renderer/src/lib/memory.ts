// Порог «безопасного» ОЗУ для игры. -Xmx - это только куча Java: процессу Minecraft нужно ещё
// 2-4 ГБ нативной памяти (текстуры, драйвер видеокарты, Distant Horizons), плюс Windows и фоновые
// программы. Если отдать куче почти всё, Windows упирается в лимит выделения (RAM + файл подкачки)
// и JVM падает с «insufficient memory» / «Unable to allocate texture» - даже при свободной физической RAM.

/** Сколько МБ можно суммарно отдать игре(ам), не рискуя вылетом. */
export function safeMemoryMb(totalRamMb: number): number {
  return Math.round(totalRamMb * 0.6)
}

/** МБ → «8» / «5.5» (без единиц). */
export function formatGb(mb: number): string {
  return mb % 1024 === 0 ? String(mb / 1024) : (mb / 1024).toFixed(1)
}

/** Объём RAM системы в ГБ «как на коробке»: 16277 МБ → «16». */
export function formatRamGb(totalRamMb: number): string {
  return String(Math.round(totalRamMb / 1024))
}
