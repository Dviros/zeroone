import { EventEmitter } from 'events'
import * as net from 'net'
import * as crypto from 'crypto'

// Cap per-connection inbound buffer at 64 KB (mirrors nanoSerialApi).
const MAX_DATA_BUFFER_BYTES = 65536

// Handshake must complete within this window (ms).
const HANDSHAKE_TIMEOUT_MS = 6000

// Fixed port the Nano_D++ TCP server listens on.
const DEVICE_PORT = 3333

interface NetConnection {
  socket: net.Socket
  data: string
}

class NanoNetApi extends EventEmitter {
  private connections: Map<string, NetConnection> = new Map()

  /**
   * Open a TCP socket to `ip:3333`, run the mutual-auth HMAC handshake, and
   * register the connection under deviceId = 'net:' + ip.
   *
   * Emits:
   *   'nanoSerialApi:connected'   (deviceId)         on success
   *   'nanoSerialApi:disconnected' (deviceId)         on clean close / EOF
   *   'nanoSerialApi:device-error' (deviceId, Error)  on socket error
   *   'nanoSerialApi:update'       (deviceId, line)   for each inbound JSON line
   */
  connect(ip: string, psk: string): Promise<string> {
    const deviceId = 'net:' + ip

    if (this.connections.has(deviceId)) {
      console.log('[nanoNetApi] already connected', deviceId)
      return Promise.resolve(deviceId)
    }

    return new Promise<string>((resolve, reject) => {
      const socket = net.createConnection({ host: ip, port: DEVICE_PORT })
      socket.setNoDelay(true) // disable Nagle — low-latency small JSON frames
      // Accumulate inbound text before the handshake is done.
      let rxBuf = ''
      let handshakeDone = false
      let clientNonce: Buffer | null = null

      const failHandshake = (reason: string) => {
        const err = new Error(reason)
        socket.destroy()
        this.emit('nanoSerialApi:device-error', deviceId, err)
        reject(err)
      }

      const timer = setTimeout(() => {
        if (!handshakeDone) failHandshake('Handshake timeout')
      }, HANDSHAKE_TIMEOUT_MS)

      // --- inbound line parser (used both during and after handshake) ---
      const processLine = (line: string) => {
        if (!line) return

        if (!handshakeDone) {
          // Step 1: device sends {"hello":{"nonce":"<32hex>","proto":1}}
          // Step 3: device replies {"auth":{"ok":true,"hmac":"<64hex>"}}
          let msg: Record<string, unknown>
          try {
            msg = JSON.parse(line) as Record<string, unknown>
          } catch {
            failHandshake('Malformed JSON during handshake: ' + line)
            return
          }

          if (msg.hello) {
            // Step 1 → emit step 2
            const hello = msg.hello as { nonce: string; proto: number }
            if (hello.proto !== 1) {
              failHandshake(`Unsupported protocol version ${hello.proto}`)
              return
            }
            const deviceNonce = Buffer.from(hello.nonce, 'hex') // 16 raw bytes
            clientNonce = crypto.randomBytes(16)
            const clientHmac = crypto
              .createHmac('sha256', psk)
              .update(deviceNonce)
              .digest('hex')
            const authMsg =
              JSON.stringify({
                auth: { hmac: clientHmac, nonce: clientNonce.toString('hex') }
              }) + '\n'
            socket.write(authMsg)
          } else if (msg.auth) {
            // Step 3 — mutual auth verification
            const auth = msg.auth as { ok: boolean; hmac?: string }
            if (!auth.ok) {
              failHandshake('Device rejected credentials (auth.ok = false)')
              return
            }
            if (!auth.hmac || !clientNonce) {
              failHandshake('Device did not provide proof HMAC')
              return
            }
            const expectedProof = crypto
              .createHmac('sha256', psk)
              .update(clientNonce)
              .digest('hex')
            // Constant-time comparison to resist timing attacks.
            const devProofBuf = Buffer.from(auth.hmac, 'hex')
            const expectedBuf = Buffer.from(expectedProof, 'hex')
            if (
              devProofBuf.length !== expectedBuf.length ||
              !crypto.timingSafeEqual(devProofBuf, expectedBuf)
            ) {
              failHandshake('Device HMAC proof mismatch — possible MITM')
              return
            }

            // Auth passed.
            clearTimeout(timer)
            handshakeDone = true
            const conn: NetConnection = { socket, data: '' }
            this.connections.set(deviceId, conn)
            this.emit('nanoSerialApi:connected', deviceId)
            resolve(deviceId)
          }
          return
        }

        // Post-handshake: same logic as nanoSerialApi._handle_data, but
        // operating on the per-connection buffer managed here.
        const conn = this.connections.get(deviceId)
        if (!conn) return
        if (line.startsWith('{')) {
          this.emit('nanoSerialApi:update', deviceId, line)
        } else {
          console.warn('[nanoNetApi] Device:', line)
        }
      }

      // --- socket data handler ---
      socket.on('data', (chunk: Buffer) => {
        const conn = handshakeDone ? this.connections.get(deviceId) : null

        if (handshakeDone && conn) {
          // Use the registered connection's buffer.
          if (conn.data.length + chunk.length > MAX_DATA_BUFFER_BYTES) {
            console.error(`[nanoNetApi][${deviceId}] RX buffer overflow — dropping buffer`)
            this.emit('nanoSerialApi:device-error', deviceId, new Error('RX buffer overflow'))
            conn.data = ''
            return
          }
          conn.data += chunk.toString('utf8')
          const lines = conn.data.split('\n')
          conn.data = lines[lines.length - 1]
          for (let i = 0; i < lines.length - 1; i++) {
            processLine(lines[i].trim())
          }
        } else {
          // Still in handshake — buffer in local rxBuf.
          rxBuf += chunk.toString('utf8')
          const lines = rxBuf.split('\n')
          rxBuf = lines[lines.length - 1]
          for (let i = 0; i < lines.length - 1; i++) {
            processLine(lines[i].trim())
          }
        }
      })

      socket.on('close', () => {
        clearTimeout(timer)
        if (this.connections.has(deviceId)) {
          this.connections.delete(deviceId)
          this.emit('nanoSerialApi:disconnected', deviceId)
        } else if (!handshakeDone) {
          failHandshake('Socket closed before handshake completed')
        }
      })

      socket.on('error', (err: Error) => {
        clearTimeout(timer)
        this.connections.delete(deviceId)
        if (!handshakeDone) {
          reject(err)
        }
        this.emit('nanoSerialApi:device-error', deviceId, err)
      })

      socket.on('connect', () => {
        console.log('[nanoNetApi] TCP connected to', ip, 'waiting for hello…')
      })
    })
  }

  /**
   * Write jsonstr + '\n' to the socket for the given deviceId.
   * The renderer already JSON.stringify()s — do NOT double-encode.
   */
  send(deviceId: string, jsonstr: string): Promise<void> {
    const conn = this.connections.get(deviceId)
    if (!conn) return Promise.reject(new Error('Net device not connected: ' + deviceId))
    return new Promise<void>((resolve, reject) => {
      conn.socket.write(jsonstr + '\n', (err) => {
        if (err) {
          console.error('[nanoNetApi] write error:', err)
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }

  /** Gracefully close the socket for deviceId, emitting 'disconnected'. */
  disconnect(deviceId: string): Promise<void> {
    const conn = this.connections.get(deviceId)
    if (!conn) return Promise.reject(new Error('Net device not connected: ' + deviceId))
    return new Promise<void>((resolve) => {
      conn.socket.end(() => {
        this.connections.delete(deviceId)
        this.emit('nanoSerialApi:disconnected', deviceId)
        resolve()
      })
    })
  }
}

const nanoNetApi = new NanoNetApi()
export default nanoNetApi
