import { Auth } from 'msmc'

// Режим входа Microsoft.
//  'official' - встроенный в msmc публичный client_id официального лаунчера Minecraft
//     (00000000402b5328, легаси login.live.com-флоу). Он уже в allowlist Minecraft, поэтому
//     вход работает БЕЗ одобрения заявки. Формально это вход под видом официального лаунчера
//     (серая зона ToS) - временная мера, пока Microsoft не одобрит наше приложение.
//  'app' - наше собственное Azure-приложение (CLIENT_ID ниже). Переключить сюда, когда одобрят
//     заявку на доступ к Minecraft API; до одобрения getMinecraft() отдаёт 403.
const AUTH_MODE: 'official' | 'app' = 'official'

// Client ID нашего Azure-приложения (публичный, не секрет). Используется только в режиме 'app'.
const CLIENT_ID = 'f8594f88-e1a8-4e66-b851-1ad54959c8d1'
const REDIRECT = 'http://localhost'

export interface MclcAuth {
  access_token: string
  client_token?: string
  uuid: string
  name?: string
  user_properties?: Record<string, unknown>
  meta?: { type: string; xuid?: string; demo?: boolean }
}

export interface MsLoginResult {
  username: string
  uuid: string
  refreshToken: string
  mclc: MclcAuth
}

function makeAuth() {
  // В режиме 'official' передаём msmc только prompt-строку - библиотека сама подставит публичный
  // client_id официального лаунчера и корректный redirect (login.live.com/oauth20_desktop.srf).
  // В режиме 'app' перебиваем дефолт нашим Azure-приложением.
  return AUTH_MODE === 'official'
    ? new Auth('select_account')
    : new Auth({ client_id: CLIENT_ID, redirect: REDIRECT, prompt: 'select_account' })
}

const MS_REFRESH_ATTEMPTS = 3
const delay = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/** Похоже ли на проблему соединения (а не отказ сервера/авторизации) — тогда имеет смысл повторить. */
function isConnectionError(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string }; response?: { status?: number }; ts?: string; message?: string }
  // Сервер ответил http-статусом — это отказ (403/400 и т.п.), а не проблема связи: повтор не поможет.
  if (err?.response && typeof err.response.status === 'number') return false
  // Известные auth-коды msmc — тоже не сетевые.
  if (typeof err?.ts === 'string' && /minecraft|xsts|xbox|gui\.closed/i.test(err.ts)) return false
  const code = String(err?.code ?? err?.cause?.code ?? '')
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENETUNREACH|ECONNABORTED|ERR_NETWORK|UND_ERR/i.test(code)) return true
  const msg = String(err?.message ?? '')
  if (/network|timeout|getaddrinfo|ENOTFOUND|ECONNREFUSED|socket hang up|fetch failed|failed to fetch|unable to connect/i.test(msg)) return true
  // Нет http-ответа и нет известного auth-кода — трактуем как проблему соединения.
  return !err?.response
}

/** Превращает ошибку msmc в человеко-читаемое сообщение. */
function friendlyError(e: unknown): Error {
  const err = e as { ts?: string; response?: { status?: number }; message?: string }
  const status = err?.response?.status

  // Заявка на доступ к Minecraft API ещё не одобрена → 403 на login_with_xbox
  if (err?.ts === 'error.auth.minecraft.login' && status === 403) {
    return new Error('Доступ к Minecraft API ещё не одобрен Microsoft. Заявка на рассмотрении - пока используйте офлайн-аккаунт.')
  }
  if (err?.ts === 'error.gui.closed') {
    return new Error('Вход отменён')
  }
  if (err?.ts === 'error.auth.minecraft.profile' || err?.ts === 'error.auth.minecraft.entitlements') {
    return new Error('На этом аккаунте не куплен Minecraft: Java Edition.')
  }
  if (err?.ts === 'error.auth.xsts.userNotFound') {
    return new Error('У этого Microsoft-аккаунта нет Xbox-профиля.')
  }
  if (typeof err?.ts === 'string') return new Error(err.ts)
  return new Error(err?.message ?? 'Ошибка входа Microsoft')
}

async function finish(xbox: Awaited<ReturnType<Auth['launch']>>): Promise<MsLoginResult> {
  const mc = await xbox.getMinecraft() // ← здесь 403 пока заявка не одобрена
  const user = mc.mclc() as MclcAuth
  return {
    username: mc.profile?.name ?? user.name ?? 'Player',
    uuid: mc.profile?.id ?? user.uuid,
    refreshToken: xbox.save(),
    mclc: user
  }
}

/** Открывает окно входа Microsoft и возвращает данные аккаунта. */
export async function microsoftLogin(): Promise<MsLoginResult> {
  try {
    const auth = makeAuth()
    const xbox = await auth.launch('electron', { width: 500, height: 660, resizable: false })
    return await finish(xbox)
  } catch (e) {
    throw friendlyError(e)
  }
}

/** Тихий повторный вход по refresh-токену (перед запуском игры).
 *  При проблемах соединения повторяет до MS_REFRESH_ATTEMPTS раз, затем отдаёт человекочитаемую
 *  ошибку. Отказ сервера/авторизации (403, просрочка и т.п.) не ретраит — сразу понятный текст.
 *  onAttempt — колбэк для показа прогресса попыток. */
export async function microsoftRefresh(
  refreshToken: string,
  onAttempt?: (attempt: number, max: number) => void
): Promise<MsLoginResult> {
  for (let attempt = 1; attempt <= MS_REFRESH_ATTEMPTS; attempt++) {
    onAttempt?.(attempt, MS_REFRESH_ATTEMPTS)
    try {
      const auth = makeAuth()
      const xbox = await auth.refresh(refreshToken)
      return await finish(xbox)
    } catch (e) {
      if (!isConnectionError(e)) throw friendlyError(e) // отказ сервера/авторизации — повтор не поможет
      if (attempt < MS_REFRESH_ATTEMPTS) await delay(1500) // связь — ждём и пробуем ещё
    }
  }
  throw new Error(`Не удалось соединиться с сервером Microsoft спустя ${MS_REFRESH_ATTEMPTS} попыток. Проверьте интернет-соединение или используйте VPN.`)
}
