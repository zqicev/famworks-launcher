// Кастомизация акцентного цвета. Вся тема лаунчера завязана на --accent (и --accent-dim
// для hover), поэтому смена одного цвета перекрашивает кнопки, чекбоксы, спиннеры и подсветки.

export const DEFAULT_ACCENT = '#c5f82a'

export interface AccentPreset { name: string; hex: string }

// Пресеты подобраны светлыми — на них читается тёмный текст (#0a0a0a), которым лаунчер
// подписывает акцентные кнопки.
export const ACCENT_PRESETS: AccentPreset[] = [
  { name: 'Лайм', hex: '#c5f82a' },
  { name: 'Изумруд', hex: '#34d399' },
  { name: 'Циан', hex: '#22d3ee' },
  { name: 'Синий', hex: '#4c8dff' },
  { name: 'Фиолетовый', hex: '#a855f7' },
  { name: 'Розовый', hex: '#ec4899' },
  { name: 'Оранжевый', hex: '#fb923c' },
  { name: 'Золотой', hex: '#fbbf24' }
]

/** '#rrggbb' → [r,g,b]. Возвращает null, если строка не похожа на hex-цвет. */
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Нормализует ввод к виду '#rrggbb' в нижнем регистре; null — если это не hex. */
export function normalizeHex(hex: string): string | null {
  const rgb = parseHex(hex)
  if (!rgb) return null
  return '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('')
}

/** Затемнённый вариант акцента для hover (умножаем каналы на 0.8). */
export function deriveDim(hex: string): string {
  const rgb = parseHex(hex) ?? parseHex(DEFAULT_ACCENT)!
  return '#' + rgb.map(c => Math.round(c * 0.8).toString(16).padStart(2, '0')).join('')
}

/** Применяет акцент к :root (--accent + --accent-dim). Некорректный hex → дефолт. */
export function applyAccent(hex: string): void {
  const norm = normalizeHex(hex) ?? DEFAULT_ACCENT
  const root = document.documentElement
  root.style.setProperty('--accent', norm)
  root.style.setProperty('--accent-dim', deriveDim(norm))
}
