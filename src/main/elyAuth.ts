import { net } from 'electron'

// Ely.by — Yggdrasil-совместимый сервер авторизации (как у Mojang), + свои скины/плащи.
// Запросы шлём через net.fetch (сетевой стек Chromium): ходит как браузер, уважает системный
// прокси и по-другому делает TLS — пробивается там, где Node-axios висит в таймаут.
const AUTH = 'https://authserver.ely.by/auth'
const HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'FamWorks-Launcher' }
const TIMEOUT = 30000

export interface ElyProfile {
  accessToken: string
  clientToken: string
  uuid: string
  name: string
}

function friendly(e: unknown): Error {
  const err = e as { code?: string; response?: { data?: { errorMessage?: string; error?: string } } }
  // Сетевой сбой/таймаут — ответа нет
  if (err?.code === 'ENETWORK' || !err?.response) {
    return new Error('Не удалось связаться с Ely.by. Проверьте, открывается ли https://authserver.ely.by в браузере; если домен режется провайдером - включите VPN.')
  }
  const msg = err.response.data?.errorMessage
  const code = err.response.data?.error
  if (msg && /two factor|totp/i.test(msg)) return new Error('Нужен код двухфакторной аутентификации (2FA).')
  if (code === 'ForbiddenOperationException') return new Error(msg || 'Неверный логин или пароль.')
  return new Error(msg || (e instanceof Error ? e.message : 'Ошибка входа Ely.by'))
}

async function postJson(path: string, body: unknown): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT)
  let res: Response
  try {
    res = await net.fetch(`${AUTH}${path}`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(body),
      signal: controller.signal
    })
  } catch {
    const err = new Error('network') as Error & { code?: string }
    err.code = 'ENETWORK'
    throw err
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text()
  let data: any = {}
  try { data = text ? JSON.parse(text) : {} } catch { /* не JSON */ }
  if (!res.ok) {
    const err = new Error(data.errorMessage || `HTTP ${res.status}`) as Error & { response?: unknown }
    err.response = { data, status: res.status }
    throw err
  }
  return data
}

/** Логин по email/нику + паролю (при 2FA пароль передаётся как "пароль:код"). */
export async function elyLogin(username: string, password: string, clientToken: string): Promise<ElyProfile> {
  try {
    const data = await postJson('/authenticate', {
      username, password, clientToken, requestUser: false, agent: { name: 'Minecraft', version: 1 }
    })
    const p = data.selectedProfile
    if (!p) throw new Error('На аккаунте Ely.by нет профиля Minecraft.')
    return { accessToken: data.accessToken, clientToken: data.clientToken ?? clientToken, uuid: p.id, name: p.name }
  } catch (e) {
    throw friendly(e)
  }
}

/** Обновление токена перед запуском (accessToken живёт ограниченно). */
export async function elyRefresh(accessToken: string, clientToken: string): Promise<ElyProfile> {
  try {
    const data = await postJson('/refresh', { accessToken, clientToken, requestUser: false })
    const p = data.selectedProfile
    return { accessToken: data.accessToken, clientToken: data.clientToken ?? clientToken, uuid: p.id, name: p.name }
  } catch (e) {
    throw friendly(e)
  }
}
