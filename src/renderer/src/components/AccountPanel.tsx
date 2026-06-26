import { useState, useEffect } from 'react'
import styles from '../styles/AccountPanel.module.css'

interface Account {
  username: string
  type: 'minecraft'
}

export default function AccountPanel() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  useEffect(() => {
    Promise.all([
      window.api.store.get('accounts'),
      window.api.store.get('activeAccount')
    ]).then(([accs, act]) => {
      setAccounts(accs ?? [])
      setActive(act)
    })
  }, [])

  const selectAccount = async (username: string) => {
    setActive(username)
    await window.api.store.set('activeAccount', username)
    setOpen(false)
  }

  const addAccount = async () => {
    const name = newName.trim()
    if (!name) return
    const newAcc: Account = { username: name, type: 'minecraft' }
    const updated = [...accounts, newAcc]
    setAccounts(updated)
    await window.api.store.set('accounts', updated)
    await selectAccount(name)
    setNewName('')
    setAdding(false)
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
              <div>
                <div className={styles.accName}>{acc.username}</div>
                <div className={styles.accType}>MINECRAFT</div>
              </div>
              {acc.username === active && <span className={styles.check}>✓</span>}
            </button>
          ))}
          {adding ? (
            <div className={styles.addForm}>
              <input
                className={styles.input}
                placeholder="Ник"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addAccount()}
                autoFocus
              />
              <button className={styles.addBtn} onClick={addAccount}>Добавить</button>
            </div>
          ) : (
            <button className={styles.newAccBtn} onClick={() => setAdding(true)}>
              + Новый аккаунт
            </button>
          )}
        </div>
      )}

      <button className={styles.trigger} onClick={() => setOpen(o => !o)}>
        <div className={styles.avatar}>
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
