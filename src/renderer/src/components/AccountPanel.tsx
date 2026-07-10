import { useState, useEffect } from 'react'
import styles from '../styles/AccountPanel.module.css'

interface Account {
  id: string
  username: string
  type: 'offline' | 'microsoft' | 'ely'
  uuid?: string
  refreshToken?: string
  accessToken?: string
  clientToken?: string
  customSkins?: boolean // офлайн: подгружать скины по нику (TLauncher/Ely.by) через CustomSkinLoader
}

function validateUsername(name: string): string | null {
  if (!name.trim()) return 'Ник не может быть пустым'
  if (name.length < 3) return 'Минимум 3 символа'
  if (name.length > 16) return 'Максимум 16 символов'
  if (!/^[a-zA-Z0-9_]+$/.test(name)) return 'Только латиница, цифры и _'
  return null
}

// Миграция старых аккаунтов ({username, type:'minecraft'}) к новой схеме.
function normalize(raw: unknown): Account[] {
  if (!Array.isArray(raw)) return []
  return raw.map((a: any) => {
    if (a.id && a.type) return a as Account
    return { id: `offline:${a.username}`, username: a.username, type: 'offline' as const }
  })
}

export default function AccountPanel() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSkins, setNewSkins] = useState(true)
  const [error, setError] = useState('')
  const [msLoading, setMsLoading] = useState(false)
  const [elyForm, setElyForm] = useState(false)
  const [elyUser, setElyUser] = useState('')
  const [elyPass, setElyPass] = useState('')
  const [elyTotp, setElyTotp] = useState('')
  const [elyLoading, setElyLoading] = useState(false)

  useEffect(() => {
    Promise.all([
      window.api.store.get('accounts'),
      window.api.store.get('activeAccountId'),
      window.api.store.get('activeAccount') // старый ключ (миграция)
    ]).then(([accs, actId, legacyActive]) => {
      const list = normalize(accs)
      setAccounts(list)
      let active = (actId as string) ?? null
      if (!active && legacyActive) {
        active = `offline:${legacyActive}`
      }
      if (!active && list.length) active = list[0].id
      setActiveId(active)
    })
  }, [])

  const persist = async (list: Account[], active: string | null) => {
    setAccounts(list)
    setActiveId(active)
    await window.api.store.set('accounts', list)
    await window.api.store.set('activeAccountId', active)
  }

  const selectAccount = async (id: string) => {
    setActiveId(id)
    await window.api.store.set('activeAccountId', id)
    setOpen(false)
  }

  const addOffline = async () => {
    const name = newName.trim()
    const err = validateUsername(name)
    if (err) { setError(err); return }
    const id = `offline:${name}`
    if (accounts.find(a => a.id === id)) { setError('Такой аккаунт уже есть'); return }
    const acc: Account = { id, username: name, type: 'offline', customSkins: newSkins }
    await persist([...accounts, acc], id)
    setNewName('')
    setError('')
    setAdding(false)
  }

  const loginEly = async () => {
    if (!elyUser.trim() || !elyPass) { setError('Введите email/ник и пароль'); return }
    setElyLoading(true); setError('')
    try {
      const r = await window.api.auth.elyLogin(elyUser.trim(), elyPass, elyTotp)
      const id = `ely:${r.uuid}`
      const acc: Account = { id, username: r.name, type: 'ely', uuid: r.uuid, accessToken: r.accessToken, clientToken: r.clientToken }
      await persist([...accounts.filter(a => a.id !== id), acc], id)
      setElyForm(false); setElyUser(''); setElyPass(''); setElyTotp(''); setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setElyLoading(false)
    }
  }

  const toggleSkins = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const list = accounts.map(a => a.id === id ? { ...a, customSkins: !a.customSkins } : a)
    await persist(list, activeId)
  }

  const loginMicrosoft = async () => {
    setMsLoading(true)
    setError('')
    try {
      const res = await window.api.auth.microsoftLogin()
      const id = `msa:${res.uuid}`
      const acc: Account = {
        id, username: res.username, type: 'microsoft', uuid: res.uuid, refreshToken: res.refreshToken
      }
      const list = accounts.filter(a => a.id !== id) // обновляем если уже был
      await persist([...list, acc], id)
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setMsLoading(false)
    }
  }

  const deleteAccount = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const list = accounts.filter(a => a.id !== id)
    const active = activeId === id ? (list[0]?.id ?? null) : activeId
    await persist(list, active)
  }

  const activeAcc = accounts.find(a => a.id === activeId)

  return (
    <div className={styles.wrapper}>
      {open && (
        <div className={styles.dropdown}>
          <div className={styles.dropTitle}>АККАУНТЫ</div>

          {accounts.map(acc => (
            <button
              key={acc.id}
              className={`${styles.accRow} ${acc.id === activeId ? styles.accActive : ''}`}
              onClick={() => selectAccount(acc.id)}
            >
              <div className={`${styles.avatar} ${acc.type === 'microsoft' ? styles.avatarMs : ''}`}>
                {acc.username[0].toUpperCase()}
              </div>
              <div className={styles.accInfo}>
                <div className={styles.accName}>{acc.username}</div>
                <div className={`${styles.accType} ${acc.type !== 'offline' ? styles.typeMs : ''}`}>
                  {acc.type === 'microsoft' ? 'MICROSOFT' : acc.type === 'ely' ? 'ELY.BY' : 'ОФФЛАЙН'}
                </div>
              </div>
              {acc.type === 'offline' && (
                <button
                  className={`${styles.skinToggle} ${acc.customSkins ? styles.skinOn : ''}`}
                  onClick={(e) => toggleSkins(acc.id, e)}
                  title={acc.customSkins ? 'Скины TLauncher/Ely.by по нику: вкл' : 'Скины по нику: выкл'}
                >СКИНЫ</button>
              )}
              {acc.id === activeId && <span className={styles.check}>✓</span>}
              <button className={styles.deleteAcc} onClick={(e) => deleteAccount(acc.id, e)} title="Удалить">✕</button>
            </button>
          ))}

          {error && <div className={styles.errorRow}>{error}</div>}

          {adding ? (
            <div className={styles.addForm}>
              <div className={styles.addInputWrap}>
                <input
                  className={`${styles.input} ${error ? styles.inputError : ''}`}
                  placeholder="Ник (a-z, 0-9, _)"
                  value={newName}
                  onChange={e => { setNewName(e.target.value); setError('') }}
                  onKeyDown={e => e.key === 'Enter' && addOffline()}
                  autoFocus
                  maxLength={16}
                />
              </div>
              <button className={styles.addBtn} onClick={addOffline}>OK</button>
              <label className={styles.skinCheck}>
                <input type="checkbox" checked={newSkins} onChange={e => setNewSkins(e.target.checked)} />
                Скины по нику (TLauncher / Ely.by)
              </label>
            </div>
          ) : elyForm ? (
            <div className={styles.addForm}>
              <input className={styles.input} style={{ width: '100%' }} placeholder="Email или ник Ely.by" value={elyUser}
                onChange={e => { setElyUser(e.target.value); setError('') }} autoFocus />
              <input className={styles.input} style={{ width: '100%' }} type="password" placeholder="Пароль" value={elyPass}
                onChange={e => { setElyPass(e.target.value); setError('') }}
                onKeyDown={e => e.key === 'Enter' && loginEly()} />
              <input className={styles.input} style={{ width: '100%' }} placeholder="Код 2FA (если включён)" value={elyTotp}
                onChange={e => setElyTotp(e.target.value)} />
              <div style={{ display: 'flex', gap: 6, width: '100%' }}>
                <button className={styles.offlineBtn} style={{ flex: 1 }} onClick={() => { setElyForm(false); setError('') }}>Назад</button>
                <button className={styles.addBtn} style={{ flex: 1 }} onClick={loginEly} disabled={elyLoading}>
                  {elyLoading ? 'Вход…' : 'Войти'}
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.actions}>
              <button className={styles.msBtn} disabled title="Будет доступно после одобрения Microsoft">
                Войти через Microsoft (скоро)
              </button>
              <button className={styles.offlineBtn} onClick={() => { setElyForm(true); setError('') }}>
                Войти через Ely.by
              </button>
              <button className={styles.offlineBtn} onClick={() => { setAdding(true); setError('') }}>
                + Офлайн-аккаунт
              </button>
            </div>
          )}
        </div>
      )}

      <button className={styles.trigger} onClick={() => setOpen(o => !o)}>
        <div className={`${styles.avatar} ${!activeAcc ? styles.avatarEmpty : ''} ${activeAcc?.type === 'microsoft' ? styles.avatarMs : ''}`}>
          {activeAcc ? activeAcc.username[0].toUpperCase() : '?'}
        </div>
        <div className={styles.info}>
          <div className={styles.name}>{activeAcc?.username ?? 'Нет аккаунта'}</div>
          <div className={`${styles.type} ${activeAcc?.type === 'microsoft' ? styles.typeMs : ''}`}>
            {activeAcc ? (activeAcc.type === 'microsoft' ? 'MICROSOFT' : 'ОФФЛАЙН') : '—'}
          </div>
        </div>
        <span className={styles.chevron}>{open ? '∧' : '∨'}</span>
      </button>
    </div>
  )
}
