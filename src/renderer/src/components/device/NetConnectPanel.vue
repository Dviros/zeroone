<template>
  <!-- Offline network connect panel — shown in the device preview area when no device is connected -->
  <div class="flex flex-col gap-3 px-4 py-4 text-xs font-mono">
    <!-- Discovered devices section -->
    <div v-if="deviceStore.discoveredNetDevices.length > 0">
      <p class="mb-2 font-medium uppercase tracking-wide text-zinc-400">
        Discovered Devices
      </p>
      <div class="flex flex-col gap-2">
        <div
          v-for="dev in deviceStore.discoveredNetDevices"
          :key="dev.deviceId"
          class="flex items-center justify-between rounded border border-zinc-700 bg-zinc-900 px-3 py-2"
        >
          <div class="flex flex-col gap-0.5">
            <span class="text-zinc-100">{{ dev.name }}</span>
            <span class="text-zinc-500">{{ dev.ip }}</span>
          </div>
          <button
            class="rounded bg-zinc-700 px-3 py-1 text-zinc-200 transition-colors hover:bg-zinc-600 disabled:opacity-50"
            :disabled="connectingId === dev.deviceId"
            @click="connectDiscovered(dev)"
          >
            {{ connectingId === dev.deviceId ? 'Connecting…' : 'Connect' }}
          </button>
        </div>
      </div>
    </div>
    <div v-else class="text-center text-zinc-600">
      <p>No devices found via mDNS.</p>
      <button
        class="mt-1 text-zinc-500 underline hover:text-zinc-300"
        @click="rescan"
      >
        Rescan
      </button>
    </div>

    <div class="border-t border-zinc-800 pt-3">
      <!-- Manual connect form -->
      <p class="mb-2 font-medium uppercase tracking-wide text-zinc-400">
        Connect Manually
      </p>
      <div class="flex flex-col gap-2">
        <div class="flex flex-col gap-1">
          <label class="text-zinc-500">Device IP</label>
          <input
            v-model="manualIp"
            type="text"
            placeholder="192.168.1.x"
            class="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500"
            :disabled="!!connectingId"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-zinc-500">PSK (pre-shared key)</label>
          <div class="relative">
            <input
              v-model="manualPsk"
              :type="showPsk ? 'text' : 'password'"
              placeholder="Device PSK"
              class="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 pr-8 text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500"
              :disabled="!!connectingId"
            />
            <button
              type="button"
              tabindex="-1"
              class="absolute inset-y-0 right-2 flex items-center text-zinc-500 hover:text-zinc-300"
              @click="showPsk = !showPsk"
            >
              <component :is="showPsk ? EyeOff : Eye" class="size-3.5" />
            </button>
          </div>
        </div>
        <button
          class="rounded bg-zinc-700 px-3 py-1.5 text-zinc-200 transition-colors hover:bg-zinc-600 disabled:opacity-50"
          :disabled="!manualIp.trim() || !manualPsk.trim() || !!connectingId"
          @click="connectManual"
        >
          {{ connectingId === 'manual' ? 'Connecting…' : 'Connect' }}
        </button>
        <p v-if="errorMsg" class="text-center text-red-400">{{ errorMsg }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Eye, EyeOff } from 'lucide-vue-next'
import { useDeviceStore } from '@renderer/deviceStore'
// NetDiscoveredDevice is declared globally via src/preload/index.d.ts (included in tsconfig.web.json)


const deviceStore = useDeviceStore()

const manualIp = ref('')
const manualPsk = ref('')
const showPsk = ref(false)
const connectingId = ref<string | null>(null)
const errorMsg = ref('')

// Restore last-used IP so reconnect is one click
onMounted(() => {
  try {
    const lastIp = localStorage.getItem('net-last-ip') || ''
    if (lastIp) {
      manualIp.value = lastIp
      manualPsk.value = deviceStore.getPersistedPsk(lastIp)
    }
  } catch {
    // ignore
  }
})

async function connectDiscovered(dev: NetDiscoveredDevice) {
  errorMsg.value = ''
  // If already connected to this exact live device, nothing to do.
  if (deviceStore.connected && deviceStore.currentDeviceId === dev.deviceId) return

  // Check if we have a cached PSK for this IP
  const cachedPsk = deviceStore.getPersistedPsk(dev.ip)
  if (cachedPsk) {
    connectingId.value = dev.deviceId
    try {
      // Disconnect current device first so the Rust side is clean before connecting.
      if (deviceStore.connected) {
        await deviceStore.disconnectDeviceAsync(deviceStore.currentDeviceId!)
      }
      await deviceStore.connectNetDevice(dev.ip, cachedPsk)
    } catch (err: unknown) {
      // Cached PSK failed — fall back to manual form pre-filled with IP
      manualIp.value = dev.ip
      manualPsk.value = ''
      errorMsg.value = 'Cached PSK failed — enter PSK manually below.'
    } finally {
      connectingId.value = null
    }
  } else {
    // No cached PSK: pre-fill the manual form so user can type PSK
    manualIp.value = dev.ip
    manualPsk.value = ''
    errorMsg.value = ''
  }
}

async function connectManual() {
  errorMsg.value = ''
  connectingId.value = 'manual'
  try {
    await deviceStore.connectNetDevice(manualIp.value.trim(), manualPsk.value)
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : String(err)
  } finally {
    connectingId.value = null
  }
}

function rescan() {
  // Directly retry the remembered device — the reliable path on macOS where mDNS is flaky.
  deviceStore.autoConnectRemembered()
}
</script>
