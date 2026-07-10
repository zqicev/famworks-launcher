import axios from 'axios'

// Ely.by — Yggdrasil-совместимый сервер авторизации (как у Mojang), + свои скины/плащи.
const AUTH = 'https://authserver.ely.by/auth'

export interface ElyProfile {
  accessToken: string
  clientToken: string
  uuid: string
  name: string
}

function friendly(e: unknown): Error {
  const err = e as { response?: { data?: { errorMessage?: string; error?: string } } }
  const msg = err?.response?.data?.errorMessage
  const code = err?.response?.data?.error
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
    }, { timeout: 15000, headers: { 'Content-Type': 'application/json' } })
    const p = data.selectedProfile
    if (!p) throw new Error('На аккаунте Ely.by нет профиля Minecraft.')
    return { accessToken: data.accessToken, clientToken: data.clientToken ?? clientToken, uuid: p.id, name: p.name }
  } catch (e) {
    throw friendly(e)
  }
}

/** Обновление токена перед запуском (accessToken живёт ограниченно). */
export async function elyRefresh(accessToken: string, clientToken: string): Promise<ElyProfile> {
  const { data } = await axios.post(`${AUTH}/refresh`, {
    accessToken, clientToken, requestUser: false
  }, { timeout: 15000, headers: { 'Content-Type': 'application/json' } })
  const p = data.selectedProfile
  return { accessToken: data.accessToken, clientToken: data.clientToken ?? clientToken, uuid: p.id, name: p.name }
}
