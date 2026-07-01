import net from 'net'
import dns from 'dns'

export interface PingResult {
  online: number
  max: number
  favicon: string | null // data:image/png;base64,...
  ping: number // мс
  motd: string
  version: string
}

function writeVarInt(value: number): number[] {
  const out: number[] = []
  let v = value
  for (let i = 0; i < 5; i++) {
    if ((v & ~0x7f) === 0) {
      out.push(v & 0xff)
      return out
    }
    out.push((v & 0x7f) | 0x80)
    v >>>= 7
  }
  return out
}

function readVarInt(buf: Buffer, offset: number): { value: number; size: number } {
  let value = 0
  let size = 0
  let byte: number
  do {
    if (offset + size >= buf.length) throw new Error('incomplete')
    byte = buf[offset + size]
    value |= (byte & 0x7f) << (7 * size)
    size++
    if (size > 5) throw new Error('VarInt too big')
  } while (byte & 0x80)
  return { value, size }
}

function splitHostPort(address: string): { host: string; port?: number } {
  const idx = address.lastIndexOf(':')
  if (idx > 0 && idx > address.lastIndexOf(']')) {
    const portStr = address.slice(idx + 1)
    const port = parseInt(portStr, 10)
    if (!isNaN(port)) return { host: address.slice(0, idx), port }
  }
  return { host: address }
}

/** MOTD может быть строкой или chat-компонентом {text, extra:[...]} */
function parseMotd(desc: unknown): string {
  if (typeof desc === 'string') return desc
  if (desc && typeof desc === 'object') {
    const d = desc as { text?: string; extra?: unknown[] }
    let s = d.text ?? ''
    if (Array.isArray(d.extra)) s += d.extra.map(parseMotd).join('')
    return s
  }
  return ''
}

/** DNS SRV-запись Minecraft (_minecraft._tcp.host) — если у сервера нет явного порта. */
function resolveTarget(host: string, port?: number): Promise<{ host: string; port: number }> {
  if (port) return Promise.resolve({ host, port })
  return new Promise((res) => {
    dns.resolveSrv(`_minecraft._tcp.${host}`, (err, addrs) => {
      if (err || !addrs || addrs.length === 0) res({ host, port: 25565 })
      else res({ host: addrs[0].name, port: addrs[0].port })
    })
  })
}

/** Пробует вычленить один пакет из буфера: [VarInt длина][полезная нагрузка]. */
function tryReadPacket(buf: Buffer): { payload: Buffer; rest: Buffer } | null {
  let len: { value: number; size: number }
  try {
    len = readVarInt(buf, 0)
  } catch {
    return null // длина ещё не пришла целиком
  }
  const total = len.size + len.value
  if (buf.length < total) return null
  return { payload: buf.slice(len.size, total), rest: buf.slice(total) }
}

/** Пингует Minecraft-сервер (Server List Ping). Возвращает null, если недоступен.
 *  Латентность меряется отдельным Ping/Pong-пакетом (чистый 1 RTT), а не временем установки соединения. */
export async function pingServer(address: string, timeout = 3000): Promise<PingResult | null> {
  const parsed = splitHostPort(address)
  const target = await resolveTarget(parsed.host, parsed.port)

  return new Promise<PingResult | null>((resolve) => {
    const socket = net.createConnection({ host: target.host, port: target.port })
    let chunks: Buffer = Buffer.alloc(0)
    let phase: 'status' | 'pong' = 'status'
    let status: Omit<PingResult, 'ping'> | null = null
    let fallbackPing = 0
    let pingStart = 0
    let pongTimer: NodeJS.Timeout | undefined
    let done = false
    const connectStart = Date.now()

    const finish = (r: PingResult | null): void => {
      if (done) return
      done = true
      if (pongTimer) clearTimeout(pongTimer)
      socket.destroy()
      resolve(r)
    }

    socket.setTimeout(timeout)
    socket.on('timeout', () => finish(status ? { ...status, ping: fallbackPing } : null))
    socket.on('error', () => finish(null))

    socket.on('connect', () => {
      const hostBuf = Buffer.from(parsed.host, 'utf8')
      const hs = [
        0x00, // packet id (handshake)
        ...writeVarInt(-1), // protocol version (-1 = не важно, только статус)
        ...writeVarInt(hostBuf.length),
        ...hostBuf,
        (target.port >> 8) & 0xff,
        target.port & 0xff,
        ...writeVarInt(1) // next state = status
      ]
      socket.write(Buffer.from([...writeVarInt(hs.length), ...hs]))
      socket.write(Buffer.from([...writeVarInt(1), 0x00])) // status request
    })

    socket.on('data', (data) => {
      chunks = Buffer.concat([chunks, data])
      try {
        if (phase === 'status') {
          const pkt = tryReadPacket(chunks)
          if (!pkt) return
          chunks = pkt.rest
          let off = readVarInt(pkt.payload, 0).size // packet id
          const jsonLen = readVarInt(pkt.payload, off)
          off += jsonLen.size
          const json = JSON.parse(pkt.payload.slice(off, off + jsonLen.value).toString('utf8'))
          fallbackPing = Date.now() - connectStart
          status = {
            online: json.players?.online ?? 0,
            max: json.players?.max ?? 0,
            favicon: typeof json.favicon === 'string' ? json.favicon : null,
            motd: parseMotd(json.description),
            version: json.version?.name ?? ''
          }
          // Ping-пакет: 0x01 + 8-байтный payload; сервер эхом вернёт Pong
          pingStart = Date.now()
          const payload = Buffer.alloc(8)
          payload.writeBigInt64BE(BigInt(pingStart))
          const ping = Buffer.concat([Buffer.from([0x01]), payload])
          socket.write(Buffer.concat([Buffer.from(writeVarInt(ping.length)), ping]))
          phase = 'pong'
          // Не все серверы отвечают на Pong — не ждём дольше 1.2с, берём оценку
          pongTimer = setTimeout(() => finish(status ? { ...status, ping: fallbackPing } : null), 1200)
        }
        if (phase === 'pong') {
          const pkt = tryReadPacket(chunks)
          if (!pkt || !status) return
          finish({ ...status, ping: Date.now() - pingStart })
        }
      } catch {
        /* пакет ещё не целиком — ждём */
      }
    })
  })
}
