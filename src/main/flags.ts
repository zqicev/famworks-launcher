import axios from 'axios'
import { app } from 'electron'
import { store } from './store'

// Удалённые флаги/«рубильник» — читаются В НАЧАЛЕ запуска, до рискованных фич. Правятся коммитом в
// famworks-builds/launcher-flags.json и применяются без пересборки и скачивания (секунды). Это защита
// от фичи, которая ломает всё сразу на старте: откат версии для такого слишком медленный.
//
// Формат JSON:
//   { "killSwitch": false, "message": "", "minVersion": "1.7.0", "disabled": ["autoBackup"] }
//   killSwitch  — true: заблокировать запуск целиком (ЧП/техработы)
//   message     — текст пользователю
//   minVersion  — версии ниже заставляем обновиться
//   disabled    — имена фич, которые выключить (featureEnabled вернёт false)

export interface Flags {
  killSwitch?: boolean
  message?: string
  minVersion?: string
  disabled?: string[]
}

const RAW = 'https://raw.githubusercontent.com/zqicev/famworks-builds/main/launcher-flags.json'
const CDN = 'https://cdn.jsdelivr.net/gh/zqicev/famworks-builds@main/launcher-flags.json'

let current: Flags = {}

/** Тянем флаги. На «нет сети» — последние известные из кэша (ведём себя как в прошлый раз). */
export async function loadFlags(): Promise<Flags> {
  current = ((store.get('flagsCache') as Flags | undefined) || {})
  const sources = [`${RAW}?t=${Date.now()}`, CDN]
  for (const url of sources) {
    try {
      const res = await axios.get(url, {
        timeout: 4000,
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        validateStatus: (s) => s === 200
      })
      if (res.data && typeof res.data === 'object') {
        current = res.data as Flags
        store.set('flagsCache', current as Record<string, unknown>)
        return current
      }
    } catch { /* пробуем следующий источник */ }
  }
  return current
}

export function getFlags(): Flags { return current }

/** Фича включена, если её нет в списке disabled. По умолчанию всё включено. */
export function featureEnabled(name: string): boolean {
  return !(Array.isArray(current.disabled) && current.disabled.includes(name))
}

function cmpVersion(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d > 0 ? 1 : -1
  }
  return 0
}

export type GateMode = 'maintenance' | 'update' | null
export interface GateState { blocked: boolean; mode: GateMode; message: string }

/** Нужно ли заблокировать запуск: killSwitch (техработы) или версия ниже minVersion (обновиться). */
export function gateState(): GateState {
  if (current.killSwitch) {
    return { blocked: true, mode: 'maintenance', message: current.message || 'Идут технические работы. Запустите лаунчер чуть позже.' }
  }
  if (current.minVersion && cmpVersion(app.getVersion(), current.minVersion) < 0) {
    return { blocked: true, mode: 'update', message: current.message || 'Вышла важная версия лаунчера. Дождитесь обновления, чтобы продолжить.' }
  }
  return { blocked: false, mode: null, message: current.message || '' }
}
