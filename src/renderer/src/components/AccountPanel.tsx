import { useState, useEffect } from 'react'
import styles from '../styles/AccountPanel.module.css'

interface Account {
  username: string
  type: 'minecraft'
}

function validateUsername(name: string): string | null {
  if (!name.trim()) return 'Ник не может быть пустым'
  if (name.length < 3) return 'Минимум 3 символа'
  if (name.length > 16) return 'Максимум 16 символов'
  if (!/^[a-zA-Z0-9_]+$/.test(name)) return 'Только латиница, цифры и _'
  return null
}

export default function AccountPanel() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      window.api.store.get('accounts'),
      window.api.store.get('activeAccount')
    ]).then(([accs, act]) => {
      setAccounts((accs as Account[]) ?? [])
      setActive(act as string)
    })
  }, [])

  const selectAccount = async (username: string) => {
    setActive(username)
    await window.api.store.set('activeAccount', username)
    setOpen(false)
  }

  const addAccount = async () => {
    const name = newName.trim()
    const err = validateUsername(name)
    if (err) { setError(err); return }
    if (accounts.find(a => a.username === name)) { setError('Такой аккаунт уже есть'); return }

    const newAcc: Account = { username: name, type: 'minecraft' }
    const updated = [...accounts, newAcc]
    setAccounts(updated)
    await window.api.store.set('accounts', updated)
    await selectAccount(name)
    setNewName('')
    setError('')
    setAdding(false)
  }

  const deleteAccount = async (username: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const updated = accounts.filter(a => a.username !== username)
    setAccounts(updated)
    await window.api.store.set('accounts', updated)
    if (active === username) {
      const next = updated[0]?.username ?? null
      setActive(next)
      await window.api.store.set('activeAccount', next)
    }
  }

  const activeAcc = accounts.find(a => a.username === active)

  return (
    <div className={styles.wrapper}>
      {open && (
        <div className={styles.dropdown}>
          <div className={styles.dropTitle}>АККАУНТЫ</div>
          {accounts.map(acc => (
            <button
              key={acc.username}
              className={`${styles.accRow} ${acc.username === active ? styles.accActive : ''}`}
              onClick={() => selectAccount(acc.username)}
            >
              <div className={styles.avatar}>{acc.username[0].toUpperCase()}</div>
              <div className={styles.accInfo}>
                <div className={styles.accName}>{acc.username}</div>
                <div className={styles.accType}>MINECRAFT</div>
              </div>
              {acc.username === active && <span className={styles.check}>✓</span>}
              <button
                className={styles.deleteAcc}
                onClick={(e) => deleteAccount(acc.username, e)}
                title="Удалить аккаунт"
              >✕</button>
            </button>
          ))}
          {adding ? (
            <div className={styles.addForm}>
              <div className={styles.addInputWrap}>
                <input
                  className={`${styles.input} ${error ? styles.inputError : ''}`}
                  placeholder="Ник (a-z, 0-9, _)"
                  value={newName}
                  onChange={e => { setNewName(e.target.value); setError('') }}
                  onKeyDown={e => e.key === 'Enter' && addAccount()}
                  autoFocus
                  maxLength={16}
                />
                {error && <div className={styles.error}>{error}</div>}
              </div>
              <button className={styles.addBtn} onClick={addAccount}>OK</button>
            </div>
          ) : (
            <button className={styles.newAccBtn} onClick={() => setAdding(true)}>
              + Новый аккаунт
            </button>
          )}
        </div>
      )}

      <button className={styles.trigger} onClick={() => setOpen(o => !o)}>
        <div className={`${styles.avatar} ${!activeAcc ? styles.avatarEmpty : ''}`}>
          {activeAcc ? activeAcc.username[0].toUpperCase() : '?'}
        </div>
        <div className={styles.info}>
          <div className={styles.name}>{activeAcc?.username ?? 'Нет аккаунта'}</div>
          <div className={styles.type}>MINECRAFT</div>
        </div>
        <span className={styles.chevron}>{open ? '∧' : '∨'}</span>
      </button>
    </div>
  )
}
