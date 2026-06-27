import { Auth } from 'msmc'

// Client ID нашего Azure-приложения (публичный, не секрет).
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
  return new Auth({ client_id: CLIENT_ID, redirect: REDIRECT, prompt: 'select_account' })
}

/** Превращает ошибку msmc в человеко-читаемое сообщение. */
function friendlyError(e: unknown): Error {
  const err = e as { ts?: string; response?: { status?: number }; message?: string }
  const status = err?.response?.status

  // Заявка на доступ к Minecraft API ещё не одобрена → 403 на login_with_xbox
  if (err?.ts === 'error.auth.minecraft.login' && status === 403) {
    return new Error('Доступ к Minecraft API ещё не одобрен Microsoft. Заявка на рассмотрении — пока используйте офлайн-аккаунт.')
  }
  if (err?.ts === 'error.gui.closed') {
    return new Error('Вход отменён')
  }
  if (err?.ts === 'error.auth.minecraft.profile' || err?.ts === 'error.auth.minecraft.entitlements') {
    return new Error('На этом аккаунте не куплен Minecraft.')
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

/** Тихий повторный вход по refresh-токену (перед запуском игры). */
export async function microsoftRefresh(refreshToken: string): Promise<MsLoginResult> {
  try {
    const auth = makeAuth()
    const xbox = await auth.refresh(refreshToken)
    return await finish(xbox)
  } catch (e) {
    throw friendlyError(e)
  }
}
