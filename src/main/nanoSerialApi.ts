import { SerialPort } from 'serialport'
import { PortInfo } from '@serialport/bindings-interface'
import { EventEmitter } from 'events'

// JTAG interface, TODO: change me!
const NANO_VID_PID_PAIRS = [
  { vid: '239A', pid: '8010' },
  { vid: '303A', pid: '1001' }
]
const NANO_BAUD_RATE = 115200

// FIX #8: Cap per-connection inbound buffer to 64 KB; anything beyond is
// a runaway device — drop accumulated bytes and emit an error.
const MAX_DATA_BUFFER_BYTES = 65536

class NanoSerialApi extends EventEmitter {
  all_nano_devices: { [key: string]: PortInfo } = {}
  connected_nano_devices: { [key: string]: { port: SerialPort; data: string } } = {}

  _list() {
    return new Promise<void>((resolve, reject) => {
      SerialPort.list()
        .then((ports: PortInfo[]) => {
          const found_serials = new Set<string>()

          for (const port of ports) {
            if (
              port.serialNumber &&
              NANO_VID_PID_PAIRS.some(
                (pair) =>
                  pair.vid === port.vendorId?.toUpperCase() &&
                  pair.pid === port.productId?.toUpperCase()
              )
            ) {
              found_serials.add(port.serialNumber)
              if (this.all_nano_devices[port.serialNumber] === undefined) {
                this.all_nano_devices[port.serialNumber] = port
                this.emit('nanoSerialApi:device-attached', port.serialNumber)
                console.log('attached', port.serialNumber)
              }
            }
          }

          // FIX #4: Detect vanished devices, emit detach, and remove them.
          for (const serial of Object.keys(this.all_nano_devices)) {
            if (!found_serials.has(serial)) {
              console.log('detached', serial)
              this.emit('nanoSerialApi:device-detached', serial)
              delete this.all_nano_devices[serial]
              // Also clean up any lingering connected entry so reconnect works.
              delete this.connected_nano_devices[serial]
            }
          }

          // FIX #4: Resolve on success (was missing before).
          resolve()
        })
        .catch((error) => {
          reject(error)
        })
    })
  }

  _handle_data(
    connected_port: { port: SerialPort; data: string },
    data: Buffer,
    serialNumber: string
  ) {
    // FIX #8: Guard against unbounded buffer growth.
    if (connected_port.data.length + data.length > MAX_DATA_BUFFER_BYTES) {
      console.error(
        `[${serialNumber}] RX buffer overflow (${connected_port.data.length} bytes) — dropping buffer`
      )
      this.emit('nanoSerialApi:device-error', serialNumber, new Error('RX buffer overflow'))
      connected_port.data = ''
      return
    }

    connected_port.data += data
    const lines = connected_port.data.split('\n')
    if (lines.length > 1) {
      for (let i = 0; i < lines.length - 1; i++) {
        let line = lines[i]
        if (line.length === 0) continue

        // FIX #8 / root-cause investigation of the 'undefined' prefix:
        // The prefix was produced because the buffer was initialised as
        // `undefined` (object field never set to '') before the first
        // data event fired, so string concatenation yielded "undefined<data>".
        // Root fix: connected_port.data is now always initialised to '' when
        // the entry is inserted in connect(). The hack below is kept only as
        // a belt-and-suspenders guard for unexpected legacy data.
        if (line.startsWith('undefined')) {
          line = line.substring(9)
        }

        if (line.startsWith('{')) {
          this.emit('nanoSerialApi:update', serialNumber, line)
        } else {
          console.warn('Device: ' + line)
        }
      }
      connected_port.data = lines[lines.length - 1]
    }
  }

  list_devices() {
    const result: string[] = []
    for (const [key, value] of Object.entries(this.all_nano_devices)) {
      if (value.serialNumber) result.push(key)
    }
    console.log('list_devices', result)
    return result
  }

  async send(deviceid: string, jsonstr: string) {
    const connected_port = this.connected_nano_devices[deviceid]
    if (connected_port === undefined) {
      return Promise.reject('Device not connected')
    }
    // jsonstr must already be a string (serialisation happens exactly once in
    // the preload; the main-process handler now passes it through unchanged).
    console.log('Sending:', jsonstr)
    return new Promise<void>((resolve, reject) => {
      // FIX #5: Use write() callback to surface errors instead of swallowing.
      connected_port.port.write(jsonstr + '\n', (err) => {
        if (err) {
          console.error('write error:', err)
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }

  async connect(deviceid: string) {
    // FIX #7: Short-circuit if already connected to avoid double-open.
    if (this.connected_nano_devices[deviceid] !== undefined) {
      console.log('connect: already connected', deviceid)
      return Promise.resolve(deviceid)
    }

    return new Promise<string>((resolve, reject) => {
      const nano_device = this.all_nano_devices[deviceid]
      if (nano_device === undefined) {
        reject('Device not attached')
        return
      }
      console.log('nano_device', nano_device)
      const port = new SerialPort({
        path: nano_device.path,
        baudRate: NANO_BAUD_RATE,
        autoOpen: false
      })
      // FIX #6: Emit the correct event name so the listener in index.ts fires.
      port.on('error', (err) => {
        this.emit('nanoSerialApi:device-error', nano_device.serialNumber, err)
      })
      port.on('close', (err) => {
        if (err && err.disconnected) {
          this.emit('nanoSerialApi:disconnected', nano_device.serialNumber)
        }
        delete this.connected_nano_devices[nano_device.serialNumber!]
      })
      port.on('open', () => {
        // FIX #8 root cause: initialise data buffer to '' on open so
        // concatenation never yields "undefined<data>".
        this.connected_nano_devices[nano_device.serialNumber!] = { port: port, data: '' }
        this.emit('nanoSerialApi:connected', nano_device.serialNumber)
        resolve(nano_device.serialNumber!)
      })
      port.on('data', (data: Buffer) => {
        const connected_port = this.connected_nano_devices[nano_device.serialNumber!]
        if (connected_port) {
          this._handle_data(connected_port, data, nano_device.serialNumber!)
        }
      })
      port.open((err) => {
        if (err) {
          console.log('Error opening port: ', err)
          reject(err)
        }
      })
    })
  }

  disconnect(deviceid: string) {
    // FIX #2: Close the real SerialPort, not the PortInfo struct.
    return new Promise<string>((resolve, reject) => {
      const nano_device = this.all_nano_devices[deviceid]
      if (nano_device === undefined) {
        reject('Device not attached')
        return
      }
      const conn = this.connected_nano_devices[nano_device.serialNumber!]
      if (conn === undefined) {
        reject('Device not connected')
        return
      }
      conn.port.close((err) => {
        if (err) {
          reject(err)
        } else {
          resolve(nano_device.serialNumber!)
        }
      })
    })
  }
}

const nanoSerialApi = new NanoSerialApi()

export default nanoSerialApi
