import { promises as fsp } from 'fs'
import type { Dirent } from 'fs'
import type { FileHandle } from 'fs/promises'
import { join } from 'path'
import { Transform, Writable } from 'stream'
import type { TransformCallback } from 'stream'
import { pipeline } from 'stream/promises'
import { promisify } from 'util'
import * as zlib from 'zlib'

// Потоковая запись ZIP прямо в файл. Память — O(1) от объёма данных: файлы читаются кусками и сразу
// жмутся/пишутся на диск; в памяти только буфер записи (~1 МБ) и короткие записи оглавления.
// (adm-zip, наоборот, держит в памяти ВСЕ исходные данные + их сжатые копии + итоговый буфер архива:
// на мирах в 1 ГБ это ~3 ГБ ОЗУ в main-процессе.)
//
// Заголовок каждой записи пишем с пустыми CRC/размерами и дописываем их по позиции, когда файл дочитан
// (без data descriptor — архив читается любым распаковщиком). Если файл не дочитался (занят/исчез),
// запись откатывается целиком и файл просто пропускается — остальной архив не страдает.
// ZIP64 включается сам, когда нужен (файл > ~3.75 ГБ, архив > 4 ГБ, записей > 65535).
// Методы НЕ вызывать параллельно: каждый await-ить по очереди.

const FLUSH_AT = 1 << 20          // копим запись до 1 МБ, потом одним write на диск
const READ_CHUNK = 1 << 20        // кусок чтения исходного файла
const ZIP64_FILE = 0xf0000000     // с этого размера резервируем ZIP64-поля в локальном заголовке
const MAX32 = 0xffffffff
const FLAG_UTF8 = 0x0800          // имена в UTF-8 (миры/папки с кириллицей)

// Уже сжатое — не жмём повторно (только тратит CPU): моды, архивы, картинки, звук.
const STORE_EXT = /\.(jar|zip|mrpack|fwpack|png|jpe?g|gif|webp|ogg|mp3|gz|xz|7z|rar)$/i

const deflateRaw = promisify(zlib.deflateRaw)

// ── CRC32: нативный zlib.crc32 (Node ≥ 20.15), иначе табличный ──
const nativeCrc = (zlib as unknown as { crc32?: (data: Buffer, value?: number) => number }).crc32
let crcTable: Int32Array | null = null
export function crc32(buf: Buffer, prev = 0): number {
  if (nativeCrc) return nativeCrc(buf, prev)
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let c = ~prev
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}

function dosDateTime(d: Date): { time: number; date: number } {
  const y = d.getFullYear()
  if (!Number.isFinite(y) || y < 1980) return { time: 0, date: (1 << 5) | 1 } // 1980-01-01
  const year = Math.min(y, 2107)
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  }
}

function normName(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\/+/, '')
}

interface CdEntry {
  name: Buffer
  method: number
  time: number
  date: number
  crc: number
  csize: number
  size: number
  offset: number
  isDir: boolean
}

/** Буферизованная запись в файл с явными позициями: дописывание в конец, патч по позиции, откат. */
class Output {
  pos = 0                    // логический конец архива (смещение следующего байта)
  private flushed = 0        // столько байт уже на диске
  private pending: Buffer[] = []
  private pendingLen = 0
  private fh: FileHandle

  constructor(fh: FileHandle) { this.fh = fh }

  private async writeAt(buf: Buffer, at: number): Promise<void> {
    let off = 0
    while (off < buf.length) {
      const { bytesWritten } = await this.fh.write(buf, off, buf.length - off, at + off)
      off += bytesWritten
    }
  }

  async append(buf: Buffer): Promise<void> {
    if (!buf.length) return
    this.pending.push(buf)
    this.pendingLen += buf.length
    this.pos += buf.length
    if (this.pendingLen >= FLUSH_AT) await this.flush()
  }

  async flush(): Promise<void> {
    if (!this.pendingLen) return
    const data = this.pending.length === 1 ? this.pending[0] : Buffer.concat(this.pending, this.pendingLen)
    const at = this.flushed
    this.flushed += this.pendingLen
    this.pending = []
    this.pendingLen = 0
    await this.writeAt(data, at)
  }

  /** Перезаписывает байты по абсолютной позиции (дописываем CRC/размеры в уже выданный заголовок). */
  async patch(at: number, buf: Buffer): Promise<void> {
    if (at >= this.flushed) {
      let off = this.flushed
      for (const chunk of this.pending) {
        if (at >= off && at + buf.length <= off + chunk.length) { buf.copy(chunk, at - off); return }
        off += chunk.length
      }
      await this.flush() // патч на стыке кусков — сначала сбрасываем буфер
    }
    await this.writeAt(buf, at)
  }

  /** Откат архива до позиции to (выбрасываем недописанную запись). */
  async truncate(to: number): Promise<void> {
    if (to >= this.flushed) {
      let keep = to - this.flushed
      const next: Buffer[] = []
      for (const c of this.pending) {
        if (keep <= 0) break
        if (c.length <= keep) { next.push(c); keep -= c.length } else { next.push(c.subarray(0, keep)); keep = 0 }
      }
      this.pending = next
      this.pendingLen = to - this.flushed
    } else {
      this.pending = []
      this.pendingLen = 0
      await this.fh.truncate(to)
      this.flushed = to
    }
    this.pos = to
  }
}

function localHeader(name: Buffer, method: number, time: number, date: number, zip64: boolean,
  crc = 0, csize = 0, size = 0): Buffer {
  const extraLen = zip64 ? 20 : 0
  const h = Buffer.alloc(30 + name.length + extraLen)
  h.writeUInt32LE(0x04034b50, 0)
  h.writeUInt16LE(zip64 ? 45 : 20, 4)
  h.writeUInt16LE(FLAG_UTF8, 6)
  h.writeUInt16LE(method, 8)
  h.writeUInt16LE(time, 10)
  h.writeUInt16LE(date, 12)
  h.writeUInt32LE(crc >>> 0, 14)
  h.writeUInt32LE(zip64 ? MAX32 : csize, 18)
  h.writeUInt32LE(zip64 ? MAX32 : size, 22)
  h.writeUInt16LE(name.length, 26)
  h.writeUInt16LE(extraLen, 28)
  name.copy(h, 30)
  if (zip64) {
    const x = 30 + name.length
    h.writeUInt16LE(0x0001, x)
    h.writeUInt16LE(16, x + 2)
    h.writeBigUInt64LE(BigInt(size), x + 4)
    h.writeBigUInt64LE(BigInt(csize), x + 12)
  }
  return h
}

function centralHeader(e: CdEntry): Buffer {
  const bigSize = e.size >= MAX32
  const bigCsize = e.csize >= MAX32
  const bigOffset = e.offset >= MAX32
  const extraLen = (bigSize || bigCsize || bigOffset) ? 4 + 8 * (+bigSize + +bigCsize + +bigOffset) : 0
  const zip64 = extraLen > 0
  const h = Buffer.alloc(46 + e.name.length + extraLen)
  h.writeUInt32LE(0x02014b50, 0)
  h.writeUInt16LE(45, 4)                      // made by: MS-DOS/Windows, спецификация 4.5
  h.writeUInt16LE(zip64 ? 45 : 20, 6)
  h.writeUInt16LE(FLAG_UTF8, 8)
  h.writeUInt16LE(e.method, 10)
  h.writeUInt16LE(e.time, 12)
  h.writeUInt16LE(e.date, 14)
  h.writeUInt32LE(e.crc >>> 0, 16)
  h.writeUInt32LE(bigCsize ? MAX32 : e.csize, 20)
  h.writeUInt32LE(bigSize ? MAX32 : e.size, 24)
  h.writeUInt16LE(e.name.length, 28)
  h.writeUInt16LE(extraLen, 30)
  h.writeUInt16LE(0, 32)                      // комментарий
  h.writeUInt16LE(0, 34)                      // диск
  h.writeUInt16LE(0, 36)                      // внутренние атрибуты
  h.writeUInt32LE(e.isDir ? 0x10 : 0, 38)     // внешние (DOS): 0x10 — папка
  h.writeUInt32LE(bigOffset ? MAX32 : e.offset, 42)
  e.name.copy(h, 46)
  if (zip64) {
    let x = 46 + e.name.length
    h.writeUInt16LE(0x0001, x)
    h.writeUInt16LE(extraLen - 4, x + 2)
    x += 4
    if (bigSize) { h.writeBigUInt64LE(BigInt(e.size), x); x += 8 }
    if (bigCsize) { h.writeBigUInt64LE(BigInt(e.csize), x); x += 8 }
    if (bigOffset) { h.writeBigUInt64LE(BigInt(e.offset), x) }
  }
  return h
}

function endRecords(count: number, cdSize: number, cdOffset: number, z64At: number | null): Buffer {
  const parts: Buffer[] = []
  if (z64At !== null) {
    const r = Buffer.alloc(56)
    r.writeUInt32LE(0x06064b50, 0)
    r.writeBigUInt64LE(44n, 4)
    r.writeUInt16LE(45, 12)
    r.writeUInt16LE(45, 14)
    r.writeUInt32LE(0, 16)
    r.writeUInt32LE(0, 20)
    r.writeBigUInt64LE(BigInt(count), 24)
    r.writeBigUInt64LE(BigInt(count), 32)
    r.writeBigUInt64LE(BigInt(cdSize), 40)
    r.writeBigUInt64LE(BigInt(cdOffset), 48)
    const loc = Buffer.alloc(20)
    loc.writeUInt32LE(0x07064b50, 0)
    loc.writeUInt32LE(0, 4)
    loc.writeBigUInt64LE(BigInt(z64At), 8)
    loc.writeUInt32LE(1, 16)
    parts.push(r, loc)
  }
  const e = Buffer.alloc(22)
  e.writeUInt32LE(0x06054b50, 0)
  e.writeUInt16LE(0, 4)
  e.writeUInt16LE(0, 6)
  e.writeUInt16LE(Math.min(count, 0xffff), 8)
  e.writeUInt16LE(Math.min(count, 0xffff), 10)
  e.writeUInt32LE(Math.min(cdSize, MAX32), 12)
  e.writeUInt32LE(Math.min(cdOffset, MAX32), 16)
  e.writeUInt16LE(0, 20)
  parts.push(e)
  return Buffer.concat(parts)
}

export class ZipWriter {
  private fh: FileHandle
  private out: Output
  private entries: CdEntry[] = []
  private names = new Set<string>()
  private closed = false

  private constructor(fh: FileHandle) {
    this.fh = fh
    this.out = new Output(fh)
  }

  /** Создаёт (перезаписывает) архив по пути path. */
  static async create(path: string): Promise<ZipWriter> {
    return new ZipWriter(await fsp.open(path, 'w'))
  }

  get entryCount(): number { return this.entries.length }

  /** Кладёт файл с диска под именем name. false — файл не прочитался (занят/исчез/не файл), пропущен. */
  async addFile(absPath: string, name: string): Promise<boolean> {
    const zipName = normName(name)
    if (!zipName || zipName.endsWith('/') || this.names.has(zipName)) return false
    let fh: FileHandle
    try { fh = await fsp.open(absPath, 'r') } catch { return false }
    try {
      const st = await fh.stat()
      if (!st.isFile()) return false
      const nameBuf = Buffer.from(zipName, 'utf8')
      const method = st.size < 64 || STORE_EXT.test(zipName) ? 0 : 8
      const zip64 = st.size >= ZIP64_FILE
      const { time, date } = dosDateTime(st.mtime)
      const start = this.out.pos
      await this.out.append(localHeader(nameBuf, method, time, date, zip64))

      let crc = 0
      let size = 0
      let csize = 0
      try {
        const src = fh.createReadStream({ highWaterMark: READ_CHUNK, autoClose: false })
        const tap = new Transform({
          transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
            crc = crc32(chunk, crc)
            size += chunk.length
            cb(null, chunk)
          }
        })
        const out = this.out
        const sink = new Writable({
          write(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void) {
            csize += chunk.length
            out.append(chunk).then(() => cb(), cb)
          }
        })
        if (method === 8) await pipeline(src, tap, zlib.createDeflateRaw(), sink)
        else await pipeline(src, tap, sink)
      } catch {
        await this.out.truncate(start) // файл не дочитался — выкидываем запись, архив цел
        return false
      }
      // Файл вырос за 4 ГБ прямо во время чтения, а ZIP64-места не резервировали — пропускаем его.
      if (!zip64 && (size >= MAX32 || csize >= MAX32)) { await this.out.truncate(start); return false }

      if (zip64) {
        const c = Buffer.alloc(4); c.writeUInt32LE(crc >>> 0, 0)
        await this.out.patch(start + 14, c)
        const x = Buffer.alloc(16); x.writeBigUInt64LE(BigInt(size), 0); x.writeBigUInt64LE(BigInt(csize), 8)
        await this.out.patch(start + 30 + nameBuf.length + 4, x)
      } else {
        const p = Buffer.alloc(12)
        p.writeUInt32LE(crc >>> 0, 0); p.writeUInt32LE(csize, 4); p.writeUInt32LE(size, 8)
        await this.out.patch(start + 14, p)
      }
      this.entries.push({ name: nameBuf, method, time, date, crc, csize, size, offset: start, isDir: false })
      this.names.add(zipName)
      return true
    } finally {
      await fh.close().catch(() => { /* уже закрыт */ })
    }
  }

  /** Кладёт данные из памяти (небольшие служебные файлы: meta.json и т.п.). */
  async addBuffer(name: string, data: Buffer, mtime: Date = new Date()): Promise<void> {
    const zipName = normName(name)
    if (!zipName || this.names.has(zipName)) return
    if (data.length >= ZIP64_FILE) throw new Error('addBuffer: слишком большой буфер')
    const nameBuf = Buffer.from(zipName, 'utf8')
    const method = data.length < 64 || STORE_EXT.test(zipName) ? 0 : 8
    const body = method === 8 ? await deflateRaw(data) : data
    const crc = crc32(data)
    const { time, date } = dosDateTime(mtime)
    const start = this.out.pos
    await this.out.append(localHeader(nameBuf, method, time, date, false, crc, body.length, data.length))
    await this.out.append(body)
    this.entries.push({ name: nameBuf, method, time, date, crc, csize: body.length, size: data.length, offset: start, isDir: false })
    this.names.add(zipName)
  }

  /** Запись-папка (для пустых папок, чтобы структура сохранилась). */
  async addDirEntry(name: string, mtime: Date = new Date()): Promise<void> {
    let zipName = normName(name)
    if (!zipName) return
    if (!zipName.endsWith('/')) zipName += '/'
    if (this.names.has(zipName)) return
    const nameBuf = Buffer.from(zipName, 'utf8')
    const { time, date } = dosDateTime(mtime)
    const start = this.out.pos
    await this.out.append(localHeader(nameBuf, 0, time, date, false))
    this.entries.push({ name: nameBuf, method: 0, time, date, crc: 0, csize: 0, size: 0, offset: start, isDir: true })
    this.names.add(zipName)
  }

  /** Рекурсивно кладёт папку absDir под префиксом prefix. Возвращает число добавленных записей
   *  (пустая папка = 1 запись-папка). Недоступные файлы/подпапки пропускаются. */
  async addDir(absDir: string, prefix: string): Promise<number> {
    let ents: Dirent[]
    try { ents = await fsp.readdir(absDir, { withFileTypes: true }) } catch { return 0 }
    let count = 0
    for (const e of ents) {
      const abs = join(absDir, e.name)
      const name = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) count += await this.addDir(abs, name)
      else if (e.isFile()) { if (await this.addFile(abs, name)) count++ }
      else if (e.isSymbolicLink()) {
        // Ссылки: берём только на файлы (ссылка на папку может зациклить обход).
        try { if ((await fsp.stat(abs)).isFile() && await this.addFile(abs, name)) count++ } catch { /* битая ссылка */ }
      }
    }
    if (!ents.length && prefix) { await this.addDirEntry(prefix); count++ }
    return count
  }

  /** Дописывает оглавление и закрывает файл. */
  async finish(): Promise<void> {
    const cdOffset = this.out.pos
    for (const e of this.entries) await this.out.append(centralHeader(e))
    const cdSize = this.out.pos - cdOffset
    const n = this.entries.length
    const needZip64 = n >= 0xffff || cdOffset >= MAX32 || cdSize >= MAX32
    await this.out.append(endRecords(n, cdSize, cdOffset, needZip64 ? this.out.pos : null))
    await this.out.flush()
    this.closed = true
    await this.fh.close()
  }

  /** Бросает запись (файл остаётся недописанным — удалить его должен вызывающий). */
  async abort(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.fh.close().catch(() => { /* уже закрыт */ })
  }
}
