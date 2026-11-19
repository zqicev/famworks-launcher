import { useState, useEffect, useRef, useCallback, MutableRefObject } from 'react'
import { formatBytes } from '../lib/format'
import { ACCENT_PRESETS, DEFAULT_ACCENT, applyAccent, normalizeHex } from '../lib/theme'
import styles from '../styles/SettingsModal.module.css'

interface Props {
  installPath: string
  onPathChange: (path: string) => void
  devMode: boolean
  onDevModeChange: (v: boolean) => void
  bgImage: string | null
  onBgChange: (filename: string | null) => void
  onClose: () => void
  onDirtyChange?: (dirty: boolean) => void
  onBackupChange?: () => void
  discardRef?: MutableRefObject<(() => void) | null>
  packs: { id: string; name: string }[]
}

type Cat = 'worlds' | 'settings' | 'screenshots' | 'mods' | 'resourcepacks' | 'shaders'
const CAT_ALL: Cat[] = ['worlds', 'settings', 'screenshots', 'mods', 'resourcepacks', 'shaders']
const CAT_LABEL: Record<Cat, string> = {
  worlds: 'Миры', settings: 'Настройки', screenshots: 'Скриншоты', mods: 'Моды', resourcepacks: 'Ресурспаки', shaders: 'Шейдеры'
}
const CAT_SHORT: Record<string, string> = {
  worlds: 'миры', settings: 'настройки', screenshots: 'скрины', mods: 'моды', resourcepacks: 'рес.', shaders: 'шейд.'
}

// Настройки-предпочтения (путь, акцент, dev-режим, статистика, бэкапы) — ЧЕРНОВИК: меняются локально и
// применяются только по кнопке «Сохранить». Акцент показываем вживую как превью и откатываем, если не
// сохранили. Фон, очистка и восстановление — это действия (работают сразу), не часть черновика.
export default function SettingsModal({
  installPath, onPathChange, devMode, onDevModeChange, bgImage, onBgChange, onClose, onDirtyChange, onBackupChange, discardRef, packs
}: Props) {
  const initialAccent = useState(() => {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--accent')
    return normalizeHex(v) ?? DEFAULT_ACCENT
  })[0]

  // Черновики
  const [path, setPath] = useState(installPath)
  const [dDev, setDDev] = useState(devMode)
  const [accent, setAccent] = useState(initialAccent)
  const [dAnalytics, setDAnalytics] = useState(true)
  const [bkDirCustom, setBkDirCustom] = useState('') // '' = папка по умолчанию

  // Сохранённые значения (базовая линия для «изменено?» и отката)
  const [savedAccent, setSavedAccent] = useState(initialAccent)
  const [savedAnalytics, setSavedAnalytics] = useState(true)
  const [savedBkDirCustom, setSavedBkDirCustom] = useState('')
  const [defaultBkDir, setDefaultBkDir] = useState('')

  const [confirmOff, setConfirmOff] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [cleanMsg, setCleanMsg] = useState('')
  const [pathErr, setPathErr] = useState('')
  const [pathWarn, setPathWarn] = useState('')
  const [bkErr, setBkErr] = useState('')
  const [savedMsg, setSavedMsg] = useState('')

  // Бэкапы: список/восстановление/удаление (это действия, не черновик).
  const [backups, setBackups] = useState<Record<string, { file: string; at: number; sizeBytes: number; reason: string; categories: string[] }[]>>({})
  const [restoring, setRestoring] = useState<string | null>(null) // ключ = file
  const [deleting, setDeleting] = useState<string | null>(null)   // ключ = file
  const [restoreMsg, setRestoreMsg] = useState('')
  const [tab, setTab] = useState<'general' | 'design' | 'storage'>('general')
  const [auto, setAutoState] = useState<Record<string, boolean>>({})       // черновик: автосохранение на сборку
  const [autoSaved, setAutoSaved] = useState<Record<string, boolean>>({})  // базовая линия
  const [globalAuto, setGlobalAuto] = useState(true)                       // черновик: мастер автосохранения
  const [globalSaved, setGlobalSaved] = useState(true)                     // базовая линия
  const [autoCats, setAutoCats] = useState<Record<string, Cat[]>>({})      // черновик: категории автосейва на сборку
  const [autoCatsSaved, setAutoCatsSaved] = useState<Record<string, Cat[]>>({})
  const [catsOpenFor, setCatsOpenFor] = useState<string | null>(null)
  const catsFor = (id: string): Cat[] => autoCats[id] ?? CAT_ALL
  const reloadBackups = () => window.api.backup.listAll().then(setBackups).catch(() => {})

  useEffect(() => {
    window.api.analytics.get().then((v) => { setDAnalytics(v); setSavedAnalytics(v) }).catch(() => {})
    window.api.backup.settings().then((s) => {
      const custom = s.isDefault ? '' : s.dir
      setBkDirCustom(custom); setSavedBkDirCustom(custom)
      setDefaultBkDir(s.defaultDir)
      setGlobalAuto(s.global); setGlobalSaved(s.global)
    }).catch(() => {})
    window.api.backup.autoMap().then((m) => { setAutoState(m); setAutoSaved(m) }).catch(() => {})
    window.api.backup.autoCatsMap().then((m) => { setAutoCats(m as Record<string, Cat[]>); setAutoCatsSaved(m as Record<string, Cat[]>) }).catch(() => {})
    window.api.backup.listAll().then(setBackups).catch(() => {})
    window.api.installPath.validate(installPath).then((v) => setPathWarn(v.ok ? '' : v.reason || '')).catch(() => {})
  }, [installPath])

  const catsEq = (a: Cat[], b: Cat[]): boolean => a.length === b.length && a.every((c) => b.includes(c))
  const autoChanged =
    globalAuto !== globalSaved ||
    packs.some((p) => (auto[p.id] !== false) !== (autoSaved[p.id] !== false)) ||
    packs.some((p) => !catsEq(autoCats[p.id] ?? CAT_ALL, autoCatsSaved[p.id] ?? CAT_ALL))
  const dirty =
    path !== installPath ||
    dDev !== devMode ||
    accent !== savedAccent ||
    dAnalytics !== savedAnalytics ||
    bkDirCustom !== savedBkDirCustom ||
    autoChanged
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])

  // Акцент меняем вживую (превью). Для отката держим актуальный «сохранённый» в ref.
  const savedAccentRef = useRef(savedAccent)
  useEffect(() => { savedAccentRef.current = savedAccent }, [savedAccent])
  useEffect(() => () => { applyAccent(savedAccentRef.current) }, []) // ушли без сохранения — вернуть сохранённый акцент

  const pickAccent = (hex: string) => {
    const n = normalizeHex(hex)
    if (!n) return
    setAccent(n); applyAccent(n); setSavedMsg('')
  }

  // Откат всех черновиков к сохранённому (вызывает и App при уходе с несохранёнными изменениями).
  const discard = useCallback(() => {
    setPath(installPath); setDDev(devMode)
    setDAnalytics(savedAnalytics); setBkDirCustom(savedBkDirCustom)
    setGlobalAuto(globalSaved); setAutoState(autoSaved); setAutoCats(autoCatsSaved)
    setAccent(savedAccent); applyAccent(savedAccent)
    setPathErr(''); setBkErr(''); setSavedMsg('')
  }, [installPath, devMode, savedAnalytics, savedBkDirCustom, savedAccent, globalSaved, autoSaved, autoCatsSaved])
  useEffect(() => {
    if (!discardRef) return
    discardRef.current = discard
    return () => { if (discardRef) discardRef.current = null }
  }, [discard, discardRef])

  const save = async () => {
    // Проверка пути установки (если менялся)
    if (path !== installPath) {
      const v = await window.api.installPath.validate(path)
      if (!v.ok) { setPathErr(v.reason || 'Недопустимая папка'); return }
    }
    // Папка бэкапов (если менялась): пустая → сброс в дефолт, иначе валидируем и сохраняем
    if (bkDirCustom !== savedBkDirCustom) {
      if (bkDirCustom) {
        const r = await window.api.backup.setDir(bkDirCustom)
        if (!r.ok) { setBkErr(r.error || 'Недопустимая папка'); return }
      } else {
        await window.api.backup.resetDir()
      }
    }
    if (path !== installPath) { await window.api.store.set('installPath', path); onPathChange(path) }
    if (dDev !== devMode) { await window.api.store.set('devMode', dDev); onDevModeChange(dDev) }
    if (dAnalytics !== savedAnalytics) { await window.api.analytics.set(dAnalytics) }
    if (accent !== savedAccent) { await window.api.store.set('accentColor', accent) }
    // Автосохранение: мастер и per-pack
    if (globalAuto !== globalSaved) { await window.api.backup.setGlobal(globalAuto) }
    for (const p of packs) {
      const now = auto[p.id] !== false
      if (now !== (autoSaved[p.id] !== false)) { await window.api.backup.setAuto(p.id, now) }
      const a = autoCats[p.id] ?? CAT_ALL
      if (!catsEq(a, autoCatsSaved[p.id] ?? CAT_ALL)) { await window.api.backup.setAutoCats(p.id, a) }
    }

    setSavedAccent(accent); setSavedAnalytics(dAnalytics); setSavedBkDirCustom(bkDirCustom)
    setGlobalSaved(globalAuto); setAutoSaved({ ...auto }); setAutoCatsSaved({ ...autoCats })
    setPathErr(''); setBkErr(''); setPathWarn(''); setSavedMsg('Настройки сохранены')
    onBackupChange?.()
  }

  const toggleDev = () => { setDDev((v) => !v); setSavedMsg('') }
  // Автосохранение (мастер и per-pack) — черновик, применяется по «Сохранить».
  const toggleGlobalAuto = () => { setGlobalAuto((v) => !v); setSavedMsg('') }
  const toggleAuto = (packId: string) => {
    setAutoState((a) => ({ ...a, [packId]: a[packId] === false }))
    setSavedMsg('')
  }
  const toggleAutoCat = (packId: string, c: Cat) => {
    setAutoCats((m) => {
      const cur = m[packId] ?? CAT_ALL
      return { ...m, [packId]: cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c] }
    })
    setSavedMsg('')
  }
  const toggleAnalytics = () => {
    if (dAnalytics) setConfirmOff(true)          // выключение — через подтверждение
    else { setDAnalytics(true); setSavedMsg('') } // включение — сразу (в черновик)
  }
  const confirmDisableAnalytics = () => { setDAnalytics(false); setConfirmOff(false); setSavedMsg('') }

  const pickFolder = async () => {
    const p = await window.api.dialog.pickFolder()
    if (p) { setPath(p); setPathErr(''); setSavedMsg('') }
  }

  // Фон — файловое действие, применяется сразу.
  const pickBg = async () => {
    const r = await window.api.bg.pick()
    if (r.filename) onBgChange(r.filename)
  }
  const clearBg = async () => { await window.api.bg.clear(); onBgChange(null) }

  // Папка бэкапов (черновик)
  const changeBackupDir = async () => {
    const p = await window.api.dialog.pickFolder()
    if (!p) return
    const v = await window.api.installPath.validate(p)
    if (!v.ok) { setBkErr(v.reason || 'Недопустимая папка'); return }
    setBkDirCustom(p); setBkErr(''); setSavedMsg('')
  }
  const resetBackupDir = () => { setBkDirCustom(''); setBkErr(''); setSavedMsg('') }

  // Очистка — действие
  const cleanup = async () => {
    setCleaning(true); setCleanMsg('')
    try {
      const r = await window.api.cleanupJunk()
      setCleanMsg(r.freedBytes > 0 ? `Освобождено ${formatBytes(r.freedBytes)} (сборок: ${r.instances})` : 'Мусора не найдено — всё чисто')
    } catch {
      setCleanMsg('Не удалось очистить')
    } finally {
      setCleaning(false)
    }
  }

  // Восстановление из копии — действие (возвращает файлы из копии)
  const restore = async (packId: string, file: string) => {
    setRestoring(file); setRestoreMsg('')
    try {
      const r = await window.api.backup.restore(packId, file)
      setRestoreMsg(r.ok ? 'Восстановлено из копии' : r.error || 'Не удалось восстановить')
      await reloadBackups() // появилась страховочная копия «перед восстановлением»
    } catch {
      setRestoreMsg('Не удалось восстановить')
    } finally {
      setRestoring(null)
    }
  }
  const del = async (packId: string, file: string) => {
    setDeleting(file); setRestoreMsg('')
    try { await window.api.backup.delete(packId, file); await reloadBackups() }
    catch { /* ignore */ }
    finally { setDeleting(null) }
  }

  const BK_REASON: Record<string, string> = {
    auto: 'после игры', manual: 'вручную', version: 'перед сменой версии', prerestore: 'перед восстановлением'
  }
  const packName = (id: string) => packs.find((p) => p.id === id)?.name || id

  // Ручное создание копии с выбором категорий.
  const [createFor, setCreateFor] = useState<string | null>(null)
  const [createCats, setCreateCats] = useState<Set<Cat>>(new Set(CAT_ALL))
  const [creating, setCreating] = useState(false)
  const openCreate = (packId: string) => { setCreateFor(packId); setCreateCats(new Set(CAT_ALL)); setRestoreMsg('') }
  const toggleCat = (c: Cat) => setCreateCats((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n })
  const doCreate = async () => {
    if (!createFor || !createCats.size) return
    setCreating(true)
    try { await window.api.backup.create(createFor, [...createCats], packName(createFor)); await reloadBackups() }
    catch { /* ignore */ }
    finally { setCreating(false); setCreateFor(null) }
  }

  const bkDirDisplay = bkDirCustom || defaultBkDir

  return (
    <>
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className={styles.title}>Настройки</h2>
        <button className={styles.close} onClick={onClose} title="Закрыть">✕</button>
      </div>

      <div className={styles.tabs}>
        <button className={`${styles.tab} ${tab === 'general' ? styles.tabOn : ''}`} onClick={() => setTab('general')}>Общие</button>
        <button className={`${styles.tab} ${tab === 'design' ? styles.tabOn : ''}`} onClick={() => setTab('design')}>Дизайн</button>
        <button className={`${styles.tab} ${tab === 'storage' ? styles.tabOn : ''}`} onClick={() => setTab('storage')}>Хранилище</button>
      </div>

      <div className={styles.body}>
        <div className={styles.pageInner}>

          {tab === 'general' && (
            <>
              <div className={styles.field}>
                <label className={styles.label}>ПАПКА УСТАНОВКИ</label>
                <div className={styles.pathRow}>
                  <div className={styles.pathDisplay}>
                    {path || <span className={styles.placeholder}>Не выбрана</span>}
                  </div>
                  <button className={styles.browseBtn} onClick={pickFolder}>Обзор</button>
                  {path && (
                    <button className={styles.iconBtn} onClick={() => window.api.shell.openFolder(path)} title="Открыть в проводнике">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 5h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
                      </svg>
                    </button>
                  )}
                </div>
                <p className={styles.hint}>Сборки устанавливаются в отдельные подпапки внутри этой директории.</p>
                {pathWarn && (
                  <p className={styles.hint} style={{ color: 'var(--red)' }}>
                    Текущая папка небезопасна: {pathWarn} Файлы может стереть обновление - перенесите сборки в другую папку и укажите её здесь.
                  </p>
                )}
                {pathErr && <p className={styles.hint} style={{ color: 'var(--red)' }}>{pathErr}</p>}
                {/[^\x00-\x7f]/.test(path) && (
                  <p className={styles.hint} style={{ color: 'var(--red)' }}>
                    В пути есть не-латинские символы (кириллица). Некоторые сборки, особенно Forge, из такой
                    папки могут не запускаться - лучше путь только из латинских букв, цифр и _.
                  </p>
                )}
              </div>

              <button className={styles.switchCard} onClick={toggleDev}>
                <div className={styles.switchHead}>
                  <span className={styles.switchTitle}>Режим разработчика</span>
                  <span className={`${styles.switch} ${dDev ? styles.switchOn : ''}`}><span className={styles.knob} /></span>
                </div>
                <div className={styles.switchBody}>
                  <p className={styles.switchDesc}>Вкладка «Разработка»: запуск с отладкой (JDWP) и интеграция с IntelliJ IDEA.</p>
                </div>
              </button>

              <button className={styles.switchCard} onClick={toggleAnalytics}>
                <div className={styles.switchHead}>
                  <span className={styles.switchTitle}>Отправлять статистику</span>
                  <span className={`${styles.switch} ${dAnalytics ? styles.switchOn : ''}`}><span className={styles.knob} /></span>
                </div>
                <div className={styles.switchBody}>
                  <p className={styles.switchDesc}>Анонимные события лаунчера (запуски, вылеты, версии) помогают улучшать лаунчер и сборки. IP, железо и файлы не собираются.</p>
                </div>
              </button>
            </>
          )}

          {tab === 'design' && (
            <>
              <div className={styles.field}>
                <label className={styles.label}>АКЦЕНТНЫЙ ЦВЕТ</label>
                <div className={styles.swatchRow}>
                  {ACCENT_PRESETS.map((p) => (
                    <button
                      key={p.hex}
                      className={`${styles.swatch} ${accent === p.hex ? styles.swatchOn : ''}`}
                      style={{ background: p.hex }}
                      onClick={() => pickAccent(p.hex)}
                      title={p.name}
                    />
                  ))}
                  <label className={styles.swatchCustom} title="Свой цвет" style={{ background: accent }}>
                    <input type="color" value={accent} onChange={(e) => pickAccent(e.target.value)} />
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><path d="M2 2l7.586 7.586" /><circle cx="11" cy="11" r="2" />
                    </svg>
                  </label>
                </div>
                <p className={styles.hint}>
                  Цвет акцентов интерфейса. Выбери пресет или свой.
                  {accent !== DEFAULT_ACCENT && (
                    <> · <button className={styles.linkBtn} onClick={() => pickAccent(DEFAULT_ACCENT)}>сбросить</button></>
                  )}
                </p>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>ФОН ЛАУНЧЕРА</label>
                <div className={styles.pathRow}>
                  <button className={styles.browseBtn} onClick={pickBg}>{bgImage ? 'Сменить фон' : 'Выбрать фон'}</button>
                  {bgImage && <button className={styles.iconBtn} onClick={clearBg} title="Убрать фон">Убрать</button>}
                </div>
                <p className={styles.hint}>
                  Своя картинка на фон (применяется сразу). Приглушается затемнением и размытием, чтобы интерфейс оставался читаемым.
                </p>
              </div>
            </>
          )}

          {tab === 'storage' && (
            <>
              <div className={styles.field}>
                <label className={styles.label}>ОЧИСТКА МЕСТА</label>
                <div className={styles.pathRow}>
                  <button className={styles.browseBtn} onClick={cleanup} disabled={cleaning}>
                    {cleaning ? 'Очистка…' : 'Очистить мусор сборок'}
                  </button>
                  {cleanMsg && <span className={styles.hint} style={{ margin: 0, alignSelf: 'center' }}>{cleanMsg}</span>}
                </div>
                <p className={styles.hint}>
                  Удаляет из сборок лишнее: старые копии игровых ассетов (теперь общие) и установщики загрузчиков. Моды, миры и настройки не затрагиваются.
                </p>
              </div>

              <button className={styles.switchCard} onClick={toggleGlobalAuto}>
                <div className={styles.switchHead}>
                  <span className={styles.switchTitle}>Автосохранение сборок</span>
                  <span className={`${styles.switch} ${globalAuto ? styles.switchOn : ''}`}><span className={styles.knob} /></span>
                </div>
                <div className={styles.switchBody}>
                  <p className={styles.switchDesc}>
                    Общий переключатель для всех сборок. Ниже можно включать/выключать автосохранение для каждой сборки отдельно.
                  </p>
                </div>
              </button>

              <div className={styles.field}>
                <label className={styles.label}>ПАПКА ДЛЯ КОПИЙ</label>
                <div className={styles.pathRow}>
                  <div className={styles.pathDisplay}>{bkDirDisplay}</div>
                  <button className={styles.browseBtn} onClick={changeBackupDir}>Изменить</button>
                  {bkDirCustom && <button className={styles.iconBtn} onClick={resetBackupDir} title="Папка по умолчанию">Сброс</button>}
                </div>
                {bkErr && <p className={styles.hint} style={{ color: 'var(--red)' }}>{bkErr}</p>}
                <p className={styles.hint}>Выбирай диск, где есть место. Нельзя указывать папку лаунчера.</p>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>РЕЗЕРВНЫЕ КОПИИ ПО СБОРКАМ</label>
                <p className={styles.hint} style={{ margin: 0 }}>
                  Автосохранение - одна копия на день: моды и конфиги пишутся после удачной загрузки сборки, миры - при выходе из игры (только те, в которые играл). Храним копии за 2 последних дня. Ручные живут, пока не удалишь.
                </p>
                <div className={styles.bkList}>
                  {packs.length === 0 && <p className={styles.hint} style={{ margin: 0 }}>Сборок пока нет.</p>}
                  {packs.map((p) => {
                    const list = backups[p.id] || []
                    const packAuto = globalAuto && auto[p.id] !== false
                    const catsOpen = catsOpenFor === p.id
                    return (
                      <div key={p.id} className={styles.bkPack}>
                        <div className={styles.bkPackHead}>
                          <span className={styles.bkName}>{p.name}</span>
                          <button className={styles.autoRow} onClick={() => toggleAuto(p.id)} disabled={!globalAuto}
                            title={globalAuto ? 'Автосохранять эту сборку после игры' : 'Включите общее автосохранение выше'}>
                            <span className={styles.autoLabel}>Автосейв</span>
                            <span className={`${styles.switch} ${packAuto ? styles.switchOn : ''}`}><span className={styles.knob} /></span>
                          </button>
                        </div>

                        <div className={styles.bkBody}>
                          <div className={styles.bkActions}>
                            <button className={`${styles.actBtn} ${catsOpen ? styles.actBtnOn : ''}`} disabled={!packAuto}
                              onClick={() => setCatsOpenFor((o) => (o === p.id ? null : p.id))} title="Что автоматически сохранять">
                              Что сохранять {catsOpen ? '▴' : '▾'}
                            </button>
                            <button className={styles.actBtn} onClick={() => openCreate(p.id)} title="Сделать копию прямо сейчас">
                              + Копия сейчас
                            </button>
                          </div>

                          {catsOpen && packAuto && (
                            <div className={styles.catsRow}>
                              <span className={styles.catsHint}>Сохранять:</span>
                              {CAT_ALL.map((c) => (
                                <button key={c} className={`${styles.catChip} ${catsFor(p.id).includes(c) ? styles.catChipOn : ''}`} onClick={() => toggleAutoCat(p.id, c)}>
                                  {CAT_LABEL[c]}
                                </button>
                              ))}
                            </div>
                          )}

                          {list.length === 0
                            ? <p className={styles.bkEmpty}>Копий пока нет</p>
                            : (
                              <div className={styles.bkRows}>
                                {list.map((b) => (
                                  <div key={b.file} className={styles.bkRow}>
                                    <div className={styles.bkMeta}>
                                      <span className={styles.bkWhen}>{new Date(b.at).toLocaleString('ru-RU')} · {BK_REASON[b.reason] || b.reason} · {formatBytes(b.sizeBytes)}</span>
                                      <div className={styles.chips}>{b.categories.map((c) => <span key={c} className={styles.chip}>{CAT_SHORT[c] || c}</span>)}</div>
                                    </div>
                                    <button className={styles.iconGhost} onClick={() => window.api.backup.open(p.id, b.file)} title="Открыть папку копии">
                                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
                                    </button>
                                    <button className={styles.restoreBtn} disabled={restoring === b.file || deleting === b.file} onClick={() => restore(p.id, b.file)}>
                                      {restoring === b.file ? '…' : 'Восстановить'}
                                    </button>
                                    <button className={`${styles.iconGhost} ${styles.iconDanger}`} disabled={restoring === b.file || deleting === b.file} onClick={() => del(p.id, b.file)} title="Удалить копию">
                                      {deleting === b.file
                                        ? '…'
                                        : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {restoreMsg && <p className={styles.hint} style={{ margin: 0 }}>{restoreMsg}</p>}
                <p className={styles.hint}>
                  При восстановлении заменяются только сохранённые в копии категории (моды тоже из копии). Перед заменой делается копия текущего состояния.
                </p>
              </div>
            </>
          )}

        </div>
      </div>

      <div className={styles.footer}>
        {savedMsg && !dirty && <span className={styles.hint} style={{ margin: 0, alignSelf: 'center', color: 'var(--accent)' }}>{savedMsg}</span>}
        <button className={styles.cancelBtn} onClick={discard} disabled={!dirty}>Отмена</button>
        <button className={styles.saveBtn} onClick={save} disabled={!dirty || !path}>Сохранить</button>
      </div>
    </div>

    {confirmOff && (
      <div className={styles.overlay} style={{ zIndex: 360 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmOff(false) }}>
        <div className={styles.modal} style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
          <div className={styles.header}>
            <h2 className={styles.title}>Выключить сбор статистики?</h2>
            <button className={styles.close} onClick={() => setConfirmOff(false)}>✕</button>
          </div>
          <div className={styles.body}>
            <p className={styles.hint} style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
              МЫ НЕ СОБИРАЕМ IP-АДРЕС, СВЕДЕНИЯ О КОМПЬЮТЕРЕ И ВАШИ ФАЙЛЫ - только события лаунчера.
              Статистика помогает нам улучшать лаунчер, сборки и серверы: мы видим, что ломается и вылетает,
              какие версии стоят у игроков и как проходят съёмки.
            </p>
            <p className={styles.hint} style={{ margin: 0 }}>
              Доступ к данным имеют только Famose и zqicev, третьим лицам ничего не передаём.
            </p>
          </div>
          <div className={styles.footer}>
            <button className={styles.cancelBtn} onClick={confirmDisableAnalytics}>Выключить</button>
            <button className={styles.saveBtn} onClick={() => setConfirmOff(false)}>Оставить включённой</button>
          </div>
        </div>
      </div>
    )}

    {createFor && (
      <div className={styles.overlay} style={{ zIndex: 360 }} onMouseDown={(e) => { if (e.target === e.currentTarget && !creating) setCreateFor(null) }}>
        <div className={styles.modal} style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
          <div className={styles.header}>
            <h2 className={styles.title}>Резервная копия</h2>
            <button className={styles.close} onClick={() => !creating && setCreateFor(null)}>✕</button>
          </div>
          <div className={styles.body}>
            <p className={styles.hint} style={{ margin: 0 }}>
              «{packName(createFor)}» - выбери, что сохранить. То же заменится при восстановлении этой копии.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {CAT_ALL.map((c) => (
                <button key={c} className={styles.toggleRow} style={{ padding: '10px 14px' }} onClick={() => toggleCat(c)}>
                  <span style={{ fontSize: 13, color: 'var(--text)' }}>{CAT_LABEL[c]}</span>
                  <span className={`${styles.switch} ${createCats.has(c) ? styles.switchOn : ''}`}><span className={styles.knob} /></span>
                </button>
              ))}
            </div>
          </div>
          <div className={styles.footer}>
            <button className={styles.cancelBtn} onClick={() => setCreateFor(null)} disabled={creating}>Отмена</button>
            <button className={styles.saveBtn} onClick={doCreate} disabled={creating || createCats.size === 0}>
              {creating ? 'Создание…' : 'Создать'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
