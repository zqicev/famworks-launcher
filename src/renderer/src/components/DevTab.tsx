import { useState, useEffect } from 'react'
import styles from '../styles/DevTab.module.css'

interface DevCfg { debug: boolean; port: number; projectPath: string; ideaPath: string; watching: boolean; hotswap: boolean; jbr: string }

export default function DevTab({ modpackId }: { modpackId: string }) {
  const [cfg, setCfg] = useState<DevCfg>({ debug: false, port: 5005, projectPath: '', ideaPath: '', watching: false, hotswap: false, jbr: '' })
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null)
  const [building, setBuilding] = useState(false)

  useEffect(() => {
    window.api.dev.get(modpackId).then(setCfg).catch(() => {})
  }, [modpackId])

  useEffect(() => {
    return window.api.dev.onSynced(r => { if (r.id === modpackId) flash(`jar синхронизирован (${r.filename})`, true) })
  }, [modpackId])

  const patch = async (p: Partial<DevCfg> & { jbrPath?: string }) => {
    const next = await window.api.dev.set(modpackId, p)
    setCfg(next)
  }

  const flash = (text: string, ok: boolean) => {
    setNotice({ text, ok })
    setTimeout(() => setNotice(null), 4000)
  }

  const pickProject = async () => {
    const p = await window.api.dev.pickProject()
    if (p) patch({ projectPath: p })
  }
  const pickIdea = async () => {
    const p = await window.api.dev.pickIdea()
    if (p) patch({ ideaPath: p })
  }
  const pickJbr = async () => {
    const p = await window.api.dev.pickJbr()
    if (p) patch({ jbrPath: p })
  }
  const openIde = async () => {
    const r = await window.api.dev.openIntelliJ(modpackId)
    flash(r.ok ? 'Открываю в IntelliJ…' : (r.error ?? 'Не удалось открыть'), r.ok)
  }
  const genConfig = async () => {
    const r = await window.api.dev.runConfig(modpackId)
    flash(r.ok ? 'Конфиг отладки создан в проекте (.idea/runConfigurations)' : (r.error ?? 'Ошибка'), r.ok)
  }

  const buildAndRun = async () => {
    setBuilding(true)
    const b = await window.api.dev.build(modpackId)
    if (!b.ok) { setBuilding(false); flash(b.error ?? 'Ошибка сборки', false); return }
    const s = await window.api.dev.syncJar(modpackId)
    setBuilding(false)
    if (!s.ok) { flash(s.error ?? 'Не удалось скопировать jar', false); return }
    flash(`Собрано, jar обновлён (${s.filename}). Запускаю…`, true)
    window.api.launch.start(modpackId)
  }
  const syncOnly = async () => {
    const s = await window.api.dev.syncJar(modpackId)
    flash(s.ok ? `jar скопирован в моды (${s.filename})` : (s.error ?? 'Ошибка'), s.ok)
  }
  const toggleWatch = async () => {
    const r = await window.api.dev.watch(modpackId, !cfg.watching)
    if (!r.ok) { flash(r.error ?? 'Ошибка', false); return }
    setCfg(c => ({ ...c, watching: r.watching }))
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.intro}>
        Инструменты мододела: запуск сборки с подключаемым отладчиком и интеграция с IntelliJ IDEA.
        Тестируй свой мод прямо внутри этой сборки.
      </div>

      {/* Отладка */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <div>
            <div className={styles.cardTitle}>Отладка (JDWP)</div>
            <div className={styles.cardSub}>Игра запустится с открытым портом отладки - можно подключиться из IntelliJ.</div>
          </div>
          <button
            className={`${styles.switch} ${cfg.debug ? styles.switchOn : ''}`}
            onClick={() => patch({ debug: !cfg.debug })}
            title="Запускать с отладкой"
          ><span className={styles.knob} /></button>
        </div>

        <div className={styles.row}>
          <label className={styles.rowLabel}>Порт</label>
          <input
            className={styles.input}
            style={{ width: 90 }}
            type="number"
            value={cfg.port}
            onChange={e => setCfg(c => ({ ...c, port: Number(e.target.value) || 5005 }))}
            onBlur={() => patch({ port: cfg.port })}
          />
          <span className={styles.attachHint}>
            В IntelliJ: <b>Run → Attach to Process</b> → localhost:{cfg.port} (или готовый конфиг ниже)
          </span>
        </div>
      </section>

      {/* Проект мода / IntelliJ */}
      <section className={styles.card}>
        <div className={styles.cardTitle}>Проект мода (IntelliJ IDEA)</div>

        <div className={styles.pathRow}>
          <div className={styles.pathBox}>
            {cfg.projectPath || <span className={styles.dim}>Папка проекта не выбрана</span>}
          </div>
          <button className={styles.btn} onClick={pickProject}>Выбрать</button>
        </div>

        <div className={styles.pathRow}>
          <div className={styles.pathBox}>
            {cfg.ideaPath || <span className={styles.dim}>Путь к idea64.exe (необязательно)</span>}
          </div>
          <button className={styles.btn} onClick={pickIdea}>IntelliJ</button>
        </div>

        <div className={styles.actions}>
          <button className={styles.btnAccent} onClick={openIde} disabled={!cfg.projectPath}>Открыть в IntelliJ</button>
          <button className={styles.btn} onClick={genConfig} disabled={!cfg.projectPath}>Создать конфиг отладки</button>
        </div>
        <p className={styles.foot}>
          «Создать конфиг отладки» кладёт в проект готовый <b>Remote JVM Debug</b> на порт {cfg.port} -
          после этого в IntelliJ появится кнопка запуска отладчика, жать её после старта игры.
        </p>
      </section>

      {/* Gradle: собрать и запустить */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <div>
            <div className={styles.cardTitle}>Сборка мода (Gradle)</div>
            <div className={styles.cardSub}>gradlew build → свежий jar из build/libs копируется в моды сборки → запуск.</div>
          </div>
          <button
            className={`${styles.switch} ${cfg.watching ? styles.switchOn : ''}`}
            onClick={toggleWatch}
            disabled={!cfg.projectPath}
            title="Авто-синхронизация jar при пересборке"
          ><span className={styles.knob} /></button>
        </div>

        <div className={styles.actions}>
          <button className={styles.btnAccent} onClick={buildAndRun} disabled={!cfg.projectPath || building}>
            {building ? 'Сборка…' : 'Собрать и запустить'}
          </button>
          <button className={styles.btn} onClick={syncOnly} disabled={!cfg.projectPath}>Синхронизировать jar</button>
        </div>
        <p className={styles.foot}>
          Тумблер справа - <b>авто-синк</b>: как только пересоберёшь мод в IntelliJ, свежий jar сам заменит
          прошлую версию в модах сборки{cfg.watching ? ' (включено)' : ''}. Вывод сборки идёт во вкладку «Логи».
        </p>
      </section>

      {/* Hot-swap */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <div>
            <div className={styles.cardTitle}>Hot-swap (замена кода без рестарта)</div>
            <div className={styles.cardSub}>Запуск на JetBrains Runtime — правки применяются в живой игре.</div>
          </div>
          <button
            className={`${styles.switch} ${cfg.hotswap ? styles.switchOn : ''}`}
            onClick={() => patch({ hotswap: !cfg.hotswap })}
            disabled={!cfg.jbr}
            title={cfg.jbr ? 'Запускать с hot-swap' : 'Не найден JetBrains Runtime'}
          ><span className={styles.knob} /></button>
        </div>

        {cfg.jbr ? (
          <div className={styles.attachHint} style={{ wordBreak: 'break-all' }}>JBR: {cfg.jbr}</div>
        ) : (
          <div className={styles.pathRow}>
            <div className={styles.pathBox}><span className={styles.dim}>JetBrains Runtime не найден — укажите IntelliJ выше или JBR вручную</span></div>
            <button className={styles.btn} onClick={pickJbr}>JBR</button>
          </div>
        )}

        <p className={styles.foot}>
          После правок в IntelliJ жми <b>Reload Changed Classes</b> (Ctrl+Shift+F9) — код применится без перезапуска.
          Поддерживает тела методов и добавление методов/полей (не смену суперкласса). Hot-swap автоматически включает отладку.
        </p>
      </section>

      {notice && <div className={`${styles.notice} ${notice.ok ? styles.noticeOk : styles.noticeErr}`}>{notice.text}</div>}
    </div>
  )
}
