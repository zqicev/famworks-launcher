import { createHash } from 'crypto'

/** sha512 в hex от буфера (как у Modrinth / Get-FileHash). */
export function sha512(data: Buffer): string {
  return createHash('sha512').update(data).digest('hex')
}
