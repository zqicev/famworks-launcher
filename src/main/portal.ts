import { safeStorage } from 'electron'
import axios from 'axios'
import { store } from './store'

// Привязка лаунчера к порталу FamWorks по одноразовому коду. Discord-входа в лаунчере нет.
// Токен храним зашифрованным (safeStorage) и никуда не показываем.

const BASE = 'https://portal.famworks.ru/api/launcher'
const NICK_RE = /^[a-zA-Z0-9_]{3,16}$/

export interface PortalResult {
  ok: boolean
  paired?: boolean       // текущее состояние привязки (после операции)
  applied?: boolean      // портал реально подставил ник (false = пользователь запретил замену)
  name?: string          // ник, который сейчас на портале
  error?: string
}

function saveToken(token: string): void {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      store.set('portalToken', safeStorage.encryptString(token).toString('base64'))
    } else {
      // ОС-шифрование недоступно (напр. Linux без keyring) — best effort, помечаем префиксом.
      store.set('portalToken', 'plain:' + Buffer.from(token, 'utf8').toString('base64'))
    }
  } catch { /* не смогли сохранить — привязка проживёт только эту сессию */ }
}

function loadToken(): string | null {
  const v = store.get('portalToken') as string | null
  if (!v) return null
  if (v.startsWith('plain:')) return Buffer.from(v.slice(6), 'base64').toString('utf8')
  try { return safeStorage.decryptString(Buffer.from(v, 'base64')) } catch { return null }
}

function clearToken(): void {
  try { store.delete('portalToken') } catch { /* уже нет */ }
}

/** Ник активного аккаунта (валидный MC-ник 3-16 [a-zA-Z0-9_]). */
function activeNick(): string | null {
  const accounts = (store.get('accounts') as { id: string; username: string }[] | null) ?? []
  const activeId = store.get('activeAccountId') as string | null
  const acc = accounts.find(a => a.id === activeId) ?? accounts[0]
  const name = acc?.username?.trim()
  return name && NICK_RE.test(name) ? name : null
}

function mapError(status: number, code?: string): string {
  if (status === 400 || code === 'code_invalid') return 'Код неверный или устарел'
  if (status === 401 || code === 'bad_token') return 'Привязка отозвана — привяжите заново'
  if (status === 403) return code === 'banned' ? 'Аккаунт заблокирован на сервере' : 'Вы не участник сервера'
  if (status === 409 || code === 'minecraft_taken') return 'Этот ник уже занят другим человеком'
  if (status === 429 || code === 'rate_limited') return 'Слишком часто — попробуйте позже'
  return `Ошибка портала (${status})`
}

/** Отправляет текущий ник активного аккаунта на портал. no-op, если нет привязки/ника. */
export async function syncNick(): Promise<PortalResult> {
  const token = loadToken()
  if (!token) return { ok: false, paired: false }
  const name = activeNick()
  if (!name) return { ok: false, paired: true, error: 'Нет подходящего ника у активного аккаунта' }
  try {
    const res = await axios.put(`${BASE}/minecraft-name`, { name }, {
      headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true, timeout: 12000
    })
    if (res.status === 200) return { ok: true, paired: true, applied: !!res.data?.applied, name: res.data?.name }
    if (res.status === 401) { clearToken(); return { ok: false, paired: false, error: mapError(401) } }
    return { ok: false, paired: true, error: mapError(res.status, res.data?.error) }
  } catch {
    return { ok: false, paired: true, error: 'Нет связи с порталом' }
  }
}

/** Привязка по одноразовому коду из профиля портала. При успехе сразу пушит ник. */
export async function pair(code: string): Promise<PortalResult> {
  try {
    const res = await axios.post(`${BASE}/pair`, { code: code.trim() }, { validateStatus: () => true, timeout: 12000 })
    if (res.status === 201 && res.data?.token) {
      saveToken(res.data.token)
      const sync = await syncNick()
      return { ok: true, paired: true, applied: sync.applied, name: sync.name, error: sync.ok ? undefined : sync.error }
    }
    return { ok: false, paired: false, error: mapError(res.status, res.data?.error) }
  } catch {
    return { ok: false, paired: false, error: 'Нет связи с порталом' }
  }
}

/** Отвязка: сообщаем порталу (DELETE) и стираем токен. */
export async function unpair(): Promise<PortalResult> {
  const token = loadToken()
  if (token) {
    try {
      await axios.delete(`${BASE}/token`, {
        headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true, timeout: 12000
      })
    } catch { /* оффлайн — всё равно стираем локально */ }
  }
  clearToken()
  return { ok: true, paired: false }
}

export function portalStatus(): { paired: boolean } {
  return { paired: !!loadToken() }
}

/** Токен привязки для прочих API портала (моды). null — лаунчер не привязан. Запросы модов
 *  работают и без токена (отдаётся только release), поэтому null тут — нормальная ситуация. */
export function getPortalToken(): string | null {
  return loadToken()
}
