import axios from 'axios'
import { store } from './store'

// Привязка редактора к порталу FamWorks (код из профиля портала) + каталог наших модов.
const PORTAL = 'https://portal.famworks.ru/api/launcher'
const MODS = PORTAL + '/mods'

function token(): string { return (store.get('portalToken') as string) || '' }
function headers(): Record<string, string> { const t = token(); return t ? { Authorization: `Bearer ${t}` } : {} }

export async function portalPair(code: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await axios.post(`${PORTAL}/pair`, { code: (code || '').trim() }, { validateStatus: () => true, timeout: 12000 })
    if (res.status === 201 && res.data?.token) { store.set('portalToken', res.data.token); return { ok: true } }
    const err = res.data?.error
    const msg = res.status === 400 || err === 'code_invalid' ? 'Код неверный или устарел'
      : res.status === 403 ? 'Нет доступа (не участник сервера или заблокирован)'
      : res.status === 429 || err === 'rate_limited' ? 'Слишком часто — попробуйте позже'
      : `Ошибка портала (${res.status})`
    return { ok: false, error: msg }
  } catch {
    return { ok: false, error: 'Нет связи с порталом' }
  }
}

export function portalStatus(): { paired: boolean } { return { paired: !!token() } }
export function portalUnpair(): void { try { store.delete('portalToken') } catch { /* нет */ } }

export async function famworksCatalog(params: { mc_version?: string; loader?: string; kind?: string; q?: string }): Promise<unknown[]> {
  const res = await axios.get(`${MODS}/catalog`, { headers: headers(), params, timeout: 12000, validateStatus: s => s === 200 })
  return (res.data as unknown[]) ?? []
}

export async function famworksVersions(id: string): Promise<unknown[]> {
  const res = await axios.get(`${MODS}/catalog/${encodeURIComponent(id)}/versions`, { headers: headers(), timeout: 12000, validateStatus: s => s === 200 })
  return (res.data as unknown[]) ?? []
}
