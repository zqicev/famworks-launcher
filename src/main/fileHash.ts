import { createReadStream } from 'fs'
import { createHash } from 'crypto'

/** Хэши файла (hex) за один проход, потоково — файл не грузится в память целиком
 *  (моды/ресурспаки бывают по 100+ МБ). size — сколько байт прочитано. */
export function hashFile<A extends string>(path: string, algos: readonly A[]): Promise<{ size: number; hex: Record<A, string> }> {
  return new Promise((resolve, reject) => {
    const hashes = algos.map((a) => createHash(a))
    let size = 0
    const stream = createReadStream(path, { highWaterMark: 1 << 20 })
    stream.on('data', (chunk) => {
      const buf = chunk as Buffer
      size += buf.length
      for (const h of hashes) h.update(buf)
    })
    stream.on('end', () => {
      const hex = {} as Record<A, string>
      algos.forEach((a, i) => { hex[a] = hashes[i].digest('hex') })
      resolve({ size, hex })
    })
    stream.on('error', reject)
  })
}

/** sha1 файла (hex), потоково. */
export async function sha1File(path: string): Promise<string> {
  return (await hashFile(path, ['sha1'] as const)).hex.sha1
}
