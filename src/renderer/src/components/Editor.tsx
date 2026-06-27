import { useState } from 'react'
import { LoadedModpack, Modpack, Mod } from '../../../types/modpack'
import AddModrinthModal from './AddModrinthModal'
import styles from '../styles/Editor.module.css'

interface Props {
  packKey: string
  loaded: LoadedModpack
  onSaved: (oldKey: string, saved: Modpack, fileSha: string) => void
  onDeleted: (key: string) => void
}

type Status = { kind: 'idle' | 'saving' | 'deleting' | 'uploading' | 'ok' | 'error'; msg?: string }

export default function Editor({ packKey, loaded, onSaved, onDeleted }: Props) {
  const [draft, setDraft] = useState<Modpack>(structuredClone(loaded.data))
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [addOpen, setAddOpen] = useState(false)

  const set = <K extends keyof Modpack>(key: K, value: Modpack[K]) =>
    setDraft(d => ({ ...d, [key]: value }))

  const validId = /^[a-z0-9-]+$/.test(draft.id)
  const canSave = draft.id && validId && draft.name && draft.mc_version && draft.loader_version

  const save = async () => {
    if (!canSave) { setStatus({ kind: 'error', msg: 'Заполни id (a-z, 0-9, -), название, версии' }); return }
    setStatus({ kind: 'saving' })
    try {
      const { fileSha } = await window.api.ws.save(structuredClone(draft), loaded.fileSha)
      setStatus({ kind: 'ok', msg: 'Сохранено и запушено' })
      onSaved(packKey, draft, fileSha)
      setTimeout(() => setStatus({ kind: 'idle' }), 2500)
    } catch (e) {
      setStatus({ kind: 'error', msg: e instanceof Error ? e.message : String(e) })
    }
  }

  const remove = async () => {
    if (loaded.fileSha === null) { onDeleted(packKey); return } // несохранённая
    if (!confirm(`Удалить сборку «${draft.name}» из репозитория?`)) return
    setStatus({ kind: 'deleting' })
    try {
      await window.api.ws.delete(draft.id, loaded.fileSha)
      onDeleted(packKey)
    } catch (e) {
      setStatus({ kind: 'error', msg: e instanceof Error ? e.message : String(e) })
    }
  }

  const addMod = (mod: Mod) => {
    setDraft(d => {
      if (d.mods.some(m => m.id === mod.id || m.filename === mod.filename)) return d
      return { ...d, mods: [...d.mods, mod] }
    })
  }

  const updateMod = (id: string, patch: Partial<Mod>) =>
    setDraft(d => ({ ...d, mods: d.mods.map(m => m.id === id ? { ...m, ...patch } : m) }))

  const removeMod = (id: string) =>
    setDraft(d => ({ ...d, mods: d.mods.filter(m => m.id !== id) }))

  const uploadJar = async () => {
    setStatus({ kind: 'uploading', msg: 'Загрузка jar в релиз…' })
    try {
      const res = await window.api.jar.pickAndUpload()
      if (!res) { setStatus({ kind: 'idle' }); return }
      const id = res.filename.replace(/\.jar$/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-')
      addMod({
        id, name: res.filename.replace(/\.jar$/, ''),
        filename: res.filename, download_url: res.download_url, sha512: res.sha512,
        version: '', category: 'Кастом', size_mb: res.size_mb, required: false
      })
      setStatus({ kind: 'ok', msg: 'Jar загружен в релиз' })
      setTimeout(() => setStatus({ kind: 'idle' }), 2500)
    } catch (e) {
      setStatus({ kind: 'error', msg: e instanceof Error ? e.message : String(e) })
    }
  }

  const addChangelog = () => set('changelog', [{ version: draft.mc_version, description: '' }, ...draft.changelog])
  const updateChangelog = (i: number, patch: Partial<{ version: string; description: string }>) =>
    set('changelog', draft.changelog.map((c, idx) => idx === i ? { ...c, ...patch } : c))
  const removeChangelog = (i: number) => set('changelog', draft.changelog.filter((_, idx) => idx !== i))

  const busy = status.kind === 'saving' || status.kind === 'deleting' || status.kind === 'uploading'

  return (
    <div className={styles.wrap}>
      <div className={styles.scroll}>
        {/* Метаданные */}
        <section className={styles.section}>
          <div className={styles.sectionTitle}>ОСНОВНОЕ</div>
          <div className={styles.grid}>
            <Field label="ID (a-z, 0-9, -)" full>
              <input className={`${styles.input} ${draft.id && !validId ? styles.invalid : ''}`}
                value={draft.id} placeholder="famworks-main"
                onChange={e => set('id', e.target.value)}
                disabled={loaded.fileSha !== null} />
              {loaded.fileSha !== null && <span className={styles.hint}>ID нельзя менять после сохранения</span>}
            </Field>
            <Field label="Название"><input className={styles.input} value={draft.name} onChange={e => set('name', e.target.value)} /></Field>
            <Field label="Загрузчик">
              <select className={styles.input} value={draft.loader} onChange={e => set('loader', e.target.value as 'fabric' | 'forge')}>
                <option value="fabric">Fabric</option>
                <option value="forge">Forge</option>
              </select>
            </Field>
            <Field label="Версия MC"><input className={styles.input} value={draft.mc_version} onChange={e => set('mc_version', e.target.value)} /></Field>
            <Field label="Версия загрузчика"><input className={styles.input} value={draft.loader_version} onChange={e => set('loader_version', e.target.value)} /></Field>
            <Field label="Версия Fabric API"><input className={styles.input} value={draft.fabric_api_version} onChange={e => set('fabric_api_version', e.target.value)} /></Field>
            <Field label="Краткое описание" full><input className={styles.input} value={draft.description} onChange={e => set('description', e.target.value)} /></Field>
            <Field label="Полное описание (вкладка Обзор)" full>
              <textarea className={styles.textarea} value={draft.long_description} onChange={e => set('long_description', e.target.value)} rows={3} />
            </Field>
          </div>
        </section>

        {/* Моды */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionTitle}>МОДЫ · {draft.mods.length}</div>
            <div className={styles.modActions}>
              <button className={styles.addBtn} onClick={() => setAddOpen(true)}>+ Из Modrinth</button>
              <button className={styles.jarBtn} onClick={uploadJar} disabled={busy}>↑ Загрузить .jar</button>
            </div>
          </div>
          <div className={styles.modList}>
            {draft.mods.length === 0 && <div className={styles.modsEmpty}>Модов пока нет</div>}
            {draft.mods.map(mod => (
              <div key={mod.id} className={styles.modRow}>
                <div className={styles.modAvatar}>{mod.name[0]?.toUpperCase() ?? '?'}</div>
                <div className={styles.modMain}>
                  <div className={styles.modName}>
                    {mod.name}
                    {mod.modrinth_id ? <span className={styles.srcMod}>Modrinth</span> : <span className={styles.srcJar}>jar</span>}
                  </div>
                  <div className={styles.modMeta}>{mod.filename} · {mod.size_mb} МБ{mod.version ? ` · ${mod.version}` : ''}</div>
                </div>
                <input className={styles.catInput} value={mod.category}
                  onChange={e => updateMod(mod.id, { category: e.target.value })} title="Категория" />
                <button
                  className={`${styles.reqBtn} ${mod.required ? styles.reqOn : ''}`}
                  onClick={() => updateMod(mod.id, { required: !mod.required })}
                  title={mod.required ? 'Обязательный' : 'Опциональный'}
                >
                  {mod.required ? 'REQ' : 'OPT'}
                </button>
                <button className={styles.delMod} onClick={() => removeMod(mod.id)} title="Убрать">✕</button>
              </div>
            ))}
          </div>
        </section>

        {/* Changelog */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionTitle}>ИЗМЕНЕНИЯ</div>
            <button className={styles.addBtn} onClick={addChangelog}>+ Запись</button>
          </div>
          <div className={styles.changelog}>
            {draft.changelog.map((c, i) => (
              <div key={i} className={styles.clRow}>
                <input className={styles.clVer} value={c.version} placeholder="1.21.1" onChange={e => updateChangelog(i, { version: e.target.value })} />
                <input className={styles.clDesc} value={c.description} placeholder="Что изменилось" onChange={e => updateChangelog(i, { description: e.target.value })} />
                <button className={styles.delMod} onClick={() => removeChangelog(i)}>✕</button>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Нижняя панель действий */}
      <div className={styles.footer}>
        <button className={styles.deleteBtn} onClick={remove} disabled={busy}>Удалить</button>
        <div className={styles.statusArea}>
          {status.msg && (
            <span className={`${styles.status} ${status.kind === 'error' ? styles.statusErr : status.kind === 'ok' ? styles.statusOk : ''}`}>
              {busy && <span className={styles.miniSpinner} />}{status.msg}
            </span>
          )}
        </div>
        <button className={styles.saveBtn} onClick={save} disabled={!canSave || busy}>
          {status.kind === 'saving' ? 'Сохранение…' : 'Сохранить и запушить'}
        </button>
      </div>

      {addOpen && (
        <AddModrinthModal
          mcVersion={draft.mc_version}
          loader={draft.loader}
          existing={draft.mods.map(m => m.id)}
          onAdd={addMod}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  )
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={`${styles.field} ${full ? styles.fieldFull : ''}`}>
      <label className={styles.fieldLabel}>{label}</label>
      {children}
    </div>
  )
}
