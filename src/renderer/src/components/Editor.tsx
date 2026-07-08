import { useState } from 'react'
import { LoadedModpack, Modpack, Mod, ServerEntry, ConfigFile } from '../../../types/modpack'
import AddModrinthModal from './AddModrinthModal'
import AddCurseforgeModal from './AddCurseforgeModal'
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
  const [rpAddOpen, setRpAddOpen] = useState(false)
  const [shAddOpen, setShAddOpen] = useState(false)
  const [cfMod, setCfMod] = useState(false)
  const [cfRp, setCfRp] = useState(false)
  const [cfSh, setCfSh] = useState(false)

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

  // Ресурспаки
  const resourcepacks = draft.resourcepacks ?? []
  const addRp = (m: Mod) => setDraft(d => {
    const rp = d.resourcepacks ?? []
    if (rp.some(x => x.id === m.id || x.filename === m.filename)) return d
    return { ...d, resourcepacks: [...rp, m] }
  })
  const updateRp = (id: string, patch: Partial<Mod>) =>
    set('resourcepacks', resourcepacks.map(x => x.id === id ? { ...x, ...patch } : x))
  const removeRp = (id: string) => set('resourcepacks', resourcepacks.filter(x => x.id !== id))
  const uploadRpZip = async () => {
    setStatus({ kind: 'uploading', msg: 'Загрузка ресурспака…' })
    try {
      const res = await window.api.rp.pickAndUpload()
      if (!res) { setStatus({ kind: 'idle' }); return }
      addRp({
        id: res.filename.replace(/\.zip$/i, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
        name: res.filename.replace(/\.zip$/i, ''), filename: res.filename,
        download_url: res.download_url, sha512: res.sha512, version: '', category: 'Кастом', size_mb: res.size_mb, required: false
      })
      setStatus({ kind: 'ok', msg: 'Ресурспак загружен' })
      setTimeout(() => setStatus({ kind: 'idle' }), 2500)
    } catch (e) {
      setStatus({ kind: 'error', msg: e instanceof Error ? e.message : String(e) })
    }
  }

  // Шейдеры
  const shaders = draft.shaders ?? []
  const addShader = (m: Mod) => setDraft(d => {
    const sh = d.shaders ?? []
    if (sh.some(x => x.id === m.id || x.filename === m.filename)) return d
    return { ...d, shaders: [...sh, m] }
  })
  const updateShader = (id: string, patch: Partial<Mod>) =>
    set('shaders', shaders.map(x => x.id === id ? { ...x, ...patch } : x))
  const removeShader = (id: string) => set('shaders', shaders.filter(x => x.id !== id))
  const uploadShaderZip = async () => {
    setStatus({ kind: 'uploading', msg: 'Загрузка шейдера…' })
    try {
      const res = await window.api.rp.pickAndUpload()
      if (!res) { setStatus({ kind: 'idle' }); return }
      addShader({
        id: res.filename.replace(/\.zip$/i, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
        name: res.filename.replace(/\.zip$/i, ''), filename: res.filename,
        download_url: res.download_url, sha512: res.sha512, version: '', category: 'Кастом', size_mb: res.size_mb, required: false
      })
      setStatus({ kind: 'ok', msg: 'Шейдер загружен' })
      setTimeout(() => setStatus({ kind: 'idle' }), 2500)
    } catch (e) {
      setStatus({ kind: 'error', msg: e instanceof Error ? e.message : String(e) })
    }
  }

  // Серверы
  const servers = draft.servers ?? []
  const addServer = () => set('servers', [...servers, { name: '', ip: '', port: 25565 }])
  const updateServer = (i: number, patch: Partial<ServerEntry>) =>
    set('servers', servers.map((s, idx) => idx === i ? { ...s, ...patch } : s))
  const removeServer = (i: number) => set('servers', servers.filter((_, idx) => idx !== i))

  // Конфиги
  const configs = draft.configs ?? []
  const addConfig = async () => {
    setStatus({ kind: 'uploading', msg: 'Загрузка конфига…' })
    try {
      const res = await window.api.config.pickAndUpload()
      if (!res) { setStatus({ kind: 'idle' }); return }
      const entry: ConfigFile = { path: res.suggestedPath, download_url: res.download_url, sha512: res.sha512, overwrite: false }
      set('configs', [...configs, entry])
      setStatus({ kind: 'ok', msg: 'Конфиг загружен в релиз' })
      setTimeout(() => setStatus({ kind: 'idle' }), 2500)
    } catch (e) {
      setStatus({ kind: 'error', msg: e instanceof Error ? e.message : String(e) })
    }
  }
  const updateConfig = (i: number, patch: Partial<ConfigFile>) =>
    set('configs', configs.map((c, idx) => idx === i ? { ...c, ...patch } : c))
  const removeConfig = (i: number) => set('configs', configs.filter((_, idx) => idx !== i))

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
              <select className={styles.input} value={draft.loader} onChange={e => set('loader', e.target.value as 'fabric' | 'forge' | 'neoforge' | 'quilt')}>
                <option value="fabric">Fabric</option>
                <option value="quilt">Quilt</option>
                <option value="forge">Forge</option>
                <option value="neoforge">NeoForge</option>
              </select>
            </Field>
            <Field label="Версия MC"><input className={styles.input} value={draft.mc_version} onChange={e => set('mc_version', e.target.value)} /></Field>
            <Field label="Версия загрузчика"><input className={styles.input} value={draft.loader_version} onChange={e => set('loader_version', e.target.value)} /></Field>
            {(draft.loader === 'fabric' || draft.loader === 'quilt') && (
              <Field label="Версия Fabric API"><input className={styles.input} value={draft.fabric_api_version} onChange={e => set('fabric_api_version', e.target.value)} /></Field>
            )}
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
              <button className={styles.addBtn} onClick={() => setAddOpen(true)}>+ Modrinth</button>
              <button className={styles.addBtn} onClick={() => setCfMod(true)}>+ CurseForge</button>
              <button className={styles.jarBtn} onClick={uploadJar} disabled={busy}>↑ .jar</button>
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

        {/* Ресурспаки */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionTitle}>РЕСУРСПАКИ · {resourcepacks.length}</div>
            <div className={styles.modActions}>
              <button className={styles.addBtn} onClick={() => setRpAddOpen(true)}>+ Modrinth</button>
              <button className={styles.addBtn} onClick={() => setCfRp(true)}>+ CurseForge</button>
              <button className={styles.jarBtn} onClick={uploadRpZip} disabled={busy}>↑ .zip</button>
            </div>
          </div>
          <div className={styles.modList}>
            {resourcepacks.length === 0 && <div className={styles.modsEmpty}>Ресурспаков нет</div>}
            {resourcepacks.map(p => (
              <div key={p.id} className={styles.modRow}>
                <div className={styles.modAvatar}>{p.name[0]?.toUpperCase() ?? '?'}</div>
                <div className={styles.modMain}>
                  <div className={styles.modName}>
                    {p.name}
                    {p.modrinth_id ? <span className={styles.srcMod}>Modrinth</span> : <span className={styles.srcJar}>zip</span>}
                  </div>
                  <div className={styles.modMeta}>{p.filename} · {p.size_mb} МБ{p.version ? ` · ${p.version}` : ''}</div>
                </div>
                <button className={`${styles.reqBtn} ${p.required ? styles.reqOn : ''}`} onClick={() => updateRp(p.id, { required: !p.required })} title={p.required ? 'Обязательный' : 'Опциональный'}>
                  {p.required ? 'REQ' : 'OPT'}
                </button>
                <button className={styles.delMod} onClick={() => removeRp(p.id)} title="Убрать">✕</button>
              </div>
            ))}
          </div>
        </section>

        {/* Шейдеры */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionTitle}>ШЕЙДЕРЫ · {shaders.length}</div>
            <div className={styles.modActions}>
              <button className={styles.addBtn} onClick={() => setShAddOpen(true)}>+ Modrinth</button>
              <button className={styles.addBtn} onClick={() => setCfSh(true)}>+ CurseForge</button>
              <button className={styles.jarBtn} onClick={uploadShaderZip} disabled={busy}>↑ .zip</button>
            </div>
          </div>
          <div className={styles.modList}>
            {shaders.length === 0 && <div className={styles.modsEmpty}>Шейдеров нет</div>}
            {shaders.map(p => (
              <div key={p.id} className={styles.modRow}>
                <div className={styles.modAvatar}>{p.name[0]?.toUpperCase() ?? '?'}</div>
                <div className={styles.modMain}>
                  <div className={styles.modName}>
                    {p.name}
                    {p.modrinth_id ? <span className={styles.srcMod}>Modrinth</span> : <span className={styles.srcJar}>zip</span>}
                  </div>
                  <div className={styles.modMeta}>{p.filename} · {p.size_mb} МБ{p.version ? ` · ${p.version}` : ''}</div>
                </div>
                <button className={`${styles.reqBtn} ${p.required ? styles.reqOn : ''}`} onClick={() => updateShader(p.id, { required: !p.required })} title={p.required ? 'Обязательный' : 'Опциональный'}>
                  {p.required ? 'REQ' : 'OPT'}
                </button>
                <button className={styles.delMod} onClick={() => removeShader(p.id)} title="Убрать">✕</button>
              </div>
            ))}
          </div>
        </section>

        {/* Серверы */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionTitle}>СЕРВЕРЫ · {servers.length}</div>
            <button className={styles.addBtn} onClick={addServer}>+ Сервер</button>
          </div>
          <div className={styles.changelog}>
            {servers.length === 0 && <div className={styles.modsEmpty}>Серверов нет — добавятся в мультиплеер игрока</div>}
            {servers.map((s, i) => (
              <div key={i} className={styles.srvRow}>
                <input className={styles.srvName} value={s.name} placeholder="Название" onChange={e => updateServer(i, { name: e.target.value })} />
                <input className={styles.srvIp} value={s.ip} placeholder="play.example.com" onChange={e => updateServer(i, { ip: e.target.value })} />
                <input className={styles.srvPort} type="number" value={s.port ?? 25565} placeholder="25565"
                  onChange={e => updateServer(i, { port: Number(e.target.value) || 25565 })} />
                <button className={styles.delMod} onClick={() => removeServer(i)}>✕</button>
              </div>
            ))}
          </div>
        </section>

        {/* Конфиги */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionTitle}>КОНФИГИ · {configs.length}</div>
            <button className={styles.jarBtn} onClick={addConfig} disabled={busy}>↑ Загрузить конфиг</button>
          </div>
          <div className={styles.changelog}>
            {configs.length === 0 && <div className={styles.modsEmpty}>Конфигов нет</div>}
            {configs.map((c, i) => (
              <div key={i} className={styles.cfgRow}>
                <input className={styles.cfgPath} value={c.path} placeholder="config/mod.json или options.txt"
                  onChange={e => updateConfig(i, { path: e.target.value })} title="Путь относительно папки игры" />
                <button
                  className={`${styles.reqBtn} ${c.overwrite ? styles.reqOn : ''}`}
                  onClick={() => updateConfig(i, { overwrite: !c.overwrite })}
                  title={c.overwrite ? 'Всегда перезаписывать' : 'Только если файла нет'}
                >
                  {c.overwrite ? 'FORCE' : 'ONCE'}
                </button>
                <button className={styles.delMod} onClick={() => removeConfig(i)}>✕</button>
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
      {rpAddOpen && (
        <AddModrinthModal
          kind="resourcepack"
          mcVersion={draft.mc_version}
          loader={draft.loader}
          existing={resourcepacks.map(m => m.id)}
          onAdd={addRp}
          onClose={() => setRpAddOpen(false)}
        />
      )}
      {shAddOpen && (
        <AddModrinthModal
          kind="shader"
          mcVersion={draft.mc_version}
          loader={draft.loader}
          existing={shaders.map(m => m.id)}
          onAdd={addShader}
          onClose={() => setShAddOpen(false)}
        />
      )}
      {cfMod && <AddCurseforgeModal kind="mod" mcVersion={draft.mc_version} loader={draft.loader} existing={draft.mods.map(m => m.id)} onAdd={addMod} onClose={() => setCfMod(false)} />}
      {cfRp && <AddCurseforgeModal kind="resourcepack" mcVersion={draft.mc_version} loader={draft.loader} existing={resourcepacks.map(m => m.id)} onAdd={addRp} onClose={() => setCfRp(false)} />}
      {cfSh && <AddCurseforgeModal kind="shader" mcVersion={draft.mc_version} loader={draft.loader} existing={shaders.map(m => m.id)} onAdd={addShader} onClose={() => setCfSh(false)} />}
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
