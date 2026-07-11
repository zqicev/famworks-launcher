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

const TYPE_LABEL: Record<Account['type'], string> = { offline: 'ОФФЛАЙН', ely: 'ELY.BY', microsoft: 'MICROSOFT' }

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
  const [elyForm, setElyForm] = useState(false)
  const [elyUser, setElyUser] = useState('')
  const [elyPass, setElyPass] = useState('')
  const [elyTotp, setElyTotp] = useState('')
  const [elyLoading, setElyLoading] = useState(false)

  const closeAll = (): void => { setOpen(false); setAdding(false); setElyForm(false); setError('') }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAll() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    Promise.all([
      window.api.store.get('accounts'),
      window.api.store.get('activeAccountId'),
      window.api.store.get('activeAccount') // старый ключ (миграция)
    ]).then(([accs, actId, legacyActive]) => {
      const list = normalize(accs)
      setAccounts(list)
      let active = (actId as string) ?? null
      if (!active && legacyActive) active = `offline:${legacyActive}`
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
    closeAll()
  }

  const addOffline = async () => {
    const name = newName.trim()
    const err = validateUsername(name)
    if (err) { setError(err); return }
    const id = `offline:${name}`
    if (accounts.find(a => a.id === id)) { setError('Такой аккаунт уже есть'); return }
    const acc: Account = { id, username: name, type: 'offline', customSkins: newSkins }
    await persist([...accounts, acc], id)
    setNewName(''); setError(''); setAdding(false)
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
    await persist(accounts.map(a => a.id === id ? { ...a, customSkins: !a.customSkins } : a), activeId)
  }

  const deleteAccount = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const list = accounts.filter(a => a.id !== id)
    const active = activeId === id ? (list[0]?.id ?? null) : activeId
    await persist(list, active)
  }

  const activeAcc = accounts.find(a => a.id === activeId)
  const avatarAccent = (t: Account['type']) => t !== 'offline'

  return (
    <div className={styles.wrapper}>
      {open && (
        <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) closeAll() }}>
          <div className={styles.modal}>
            <div className={styles.mHeader}>
              <h2 className={styles.mTitle}>Аккаунты</h2>
              <button className={styles.mClose} onClick={closeAll}>✕</button>
            </div>

            <div className={styles.mBody}>
              {error && <div className={styles.errorRow}>{error}</div>}

              {adding ? (
                <div className={styles.form}>
                  <input
                    className={`${styles.finput} ${error ? styles.inputError : ''}`}
                    placeholder="Ник (a-z, 0-9, _)"
                    value={newName}
                    onChange={e => { setNewName(e.target.value); setError('') }}
                    onKeyDown={e => e.key === 'Enter' && addOffline()}
                    autoFocus
                    maxLength={16}
                  />
                  <label className={styles.skinCheck}>
                    <input type="checkbox" checked={newSkins} onChange={e => setNewSkins(e.target.checked)} />
                    Скины по нику (TLauncher / Ely.by)
                  </label>
                  <div className={styles.formRow}>
                    <button className={styles.btnGhost} onClick={() => { setAdding(false); setNewName(''); setError('') }}>Назад</button>
                    <button className={styles.btnAccent} onClick={addOffline}>Добавить</button>
                  </div>
                </div>
              ) : elyForm ? (
                <div className={styles.form}>
                  <input className={styles.finput} placeholder="Email или ник Ely.by" value={elyUser}
                    onChange={e => { setElyUser(e.target.value); setError('') }} autoFocus />
                  <input className={styles.finput} type="password" placeholder="Пароль" value={elyPass}
                    onChange={e => { setElyPass(e.target.value); setError('') }}
                    onKeyDown={e => e.key === 'Enter' && loginEly()} />
                  <input className={styles.finput} placeholder="Код 2FA (если включён)" value={elyTotp}
                    onChange={e => setElyTotp(e.target.value)} />
                  <div className={styles.formRow}>
                    <button className={styles.btnGhost} onClick={() => { setElyForm(false); setError('') }}>Назад</button>
                    <button className={styles.btnAccent} onClick={loginEly} disabled={elyLoading}>{elyLoading ? 'Вход…' : 'Войти'}</button>
                  </div>
                </div>
              ) : (
                <>
                  {accounts.length === 0 && <div className={styles.empty}>Пока нет аккаунтов — добавьте ниже</div>}
                  <div className={styles.list}>
                    {accounts.map(acc => (
                      <div
                        key={acc.id}
                        className={`${styles.card} ${acc.id === activeId ? styles.cardActive : ''}`}
                        onClick={() => selectAccount(acc.id)}
                      >
                        <div className={`${styles.cAvatar} ${avatarAccent(acc.type) ? styles.cAvatarAccent : ''}`}>
                          {acc.username[0].toUpperCase()}
                        </div>
                        <div className={styles.cInfo}>
                          <div className={styles.cName}>{acc.username}</div>
                          <span className={`${styles.cBadge} ${acc.type !== 'offline' ? styles.cBadgeAccent : ''}`}>{TYPE_LABEL[acc.type]}</span>
                        </div>
                        {acc.type === 'offline' && (
                          <button
                            className={`${styles.cSkin} ${acc.customSkins ? styles.cSkinOn : ''}`}
                            onClick={e => toggleSkins(acc.id, e)}
                            title={acc.customSkins ? 'Скины по нику: вкл' : 'Скины по нику: выкл'}
                          >СКИНЫ</button>
                        )}
                        {acc.id === activeId && <span className={styles.cCheck}>✓</span>}
                        <button className={styles.cDel} onClick={e => deleteAccount(acc.id, e)} title="Удалить">✕</button>
                      </div>
                    ))}
                  </div>

                  <div className={styles.addSection}>
                    <button className={styles.addEly} onClick={() => { setElyForm(true); setError('') }}>Войти через Ely.by</button>
                    <div className={styles.addRow}>
                      <button className={styles.addBtn2} onClick={() => { setAdding(true); setError('') }}>+ Офлайн-аккаунт</button>
                      <button className={styles.addBtn2} disabled title="Будет доступно после одобрения Microsoft">Microsoft (скоро)</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <button className={styles.trigger} onClick={() => setOpen(o => !o)}>
        <div className={`${styles.avatar} ${!activeAcc ? styles.avatarEmpty : ''} ${activeAcc && activeAcc.type !== 'offline' ? styles.avatarMs : ''}`}>
          {activeAcc ? activeAcc.username[0].toUpperCase() : '?'}
        </div>
        <div className={styles.info}>
          <div className={styles.name}>{activeAcc?.username ?? 'Нет аккаунта'}</div>
          <div className={`${styles.type} ${activeAcc && activeAcc.type !== 'offline' ? styles.typeMs : ''}`}>
            {activeAcc ? TYPE_LABEL[activeAcc.type] : '—'}
          </div>
        </div>
        <span className={styles.chevron}>∨</span>
      </button>
    </div>
  )
}
