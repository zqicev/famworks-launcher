import axios from 'axios'

// Ely.by — Yggdrasil-совместимый сервер авторизации (как у Mojang), + свои скины/плащи.
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
  if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT' || err?.code === 'ENOTFOUND' || !err?.response) {
    return new Error('Не удалось связаться с Ely.by (таймаут). Проверьте интернет; если домен режется провайдером — включите VPN.')
  }
  const msg = err.response.data?.errorMessage
  const code = err.response.data?.error
  if (msg && /two factor|totp/i.test(msg)) return new Error('Нужен код двухфакторной аутентификации (2FA).')
  if (code === 'ForbiddenOperationException') return new Error(msg || 'Неверный логин или пароль.')
  return new Error(msg || (e instanceof Error ? e.message : 'Ошибка входа Ely.by'))
}

/** Логин по email/нику + паролю (при 2FA пароль передаётся как "пароль:код"). */
export async function elyLogin(username: string, password: string, clientToken: string): Promise<ElyProfile> {
  try {
    const { data } = await axios.post(`${AUTH}/authenticate`, {
      username,
      password,
      clientToken,
      requestUser: false,
      agent: { name: 'Minecraft', version: 1 }
    }, { timeout: TIMEOUT, headers: HEADERS })
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
    const { data } = await axios.post(`${AUTH}/refresh`, {
      accessToken, clientToken, requestUser: false
    }, { timeout: TIMEOUT, headers: HEADERS })
    const p = data.selectedProfile
    return { accessToken: data.accessToken, clientToken: data.clientToken ?? clientToken, uuid: p.id, name: p.name }
  } catch (e) {
    throw friendly(e)
  }
}
