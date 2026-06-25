<template>
  <ConfigSection title="WiFi" :icon-component="Wifi" :foldable="false">
    <!-- Status banner -->
    <div
      v-if="deviceStore.wifiStatus"
      class="flex items-center gap-2 border-b border-zinc-800 px-4 py-2 text-xs"
    >
      <span
        class="size-2 rounded-full"
        :class="{
          'bg-green-400': deviceStore.wifiStatus.status === 'connected',
          'bg-yellow-400': deviceStore.wifiStatus.status === 'connecting' || deviceStore.wifiStatus.status === 'ap',
          'bg-zinc-500': deviceStore.wifiStatus.status === 'disconnected'
        }"
      />
      <span class="capitalize text-muted-foreground">{{ deviceStore.wifiStatus.status }}</span>
      <span v-if="deviceStore.wifiStatus.ip" class="ml-auto font-mono text-zinc-300">
        {{ deviceStore.wifiStatus.ip }}
      </span>
    </div>

    <div class="flex flex-col gap-3 px-4 py-3">
      <!-- Enable toggle -->
      <div class="flex items-center justify-between">
        <label class="text-sm text-zinc-300">Enable WiFi</label>
        <Switch :checked="wifiEnabled" @update:checked="wifiEnabled = $event" />
      </div>

      <!-- SSID -->
      <div class="flex flex-col gap-1">
        <label class="text-xs text-muted-foreground">SSID</label>
        <Input
          v-model="ssid"
          placeholder="Network name"
          :disabled="!wifiEnabled"
          class="bg-zinc-900"
        />
      </div>

      <!-- Password -->
      <div class="flex flex-col gap-1">
        <label class="text-xs text-muted-foreground">Password</label>
        <div class="relative">
          <Input
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            placeholder="Password"
            :disabled="!wifiEnabled"
            class="bg-zinc-900 pr-9"
          />
          <button
            type="button"
            class="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-zinc-100"
            tabindex="-1"
            @click="showPassword = !showPassword"
          >
            <component :is="showPassword ? EyeOff : Eye" class="size-4" />
          </button>
        </div>
      </div>

      <!-- Connect -->
      <Button
        :disabled="!deviceStore.connected || !wifiEnabled || !ssid"
        class="w-full"
        @click="connect"
      >
        <WifiIcon class="mr-2 size-4" />
        Connect
      </Button>

      <!-- Feedback message -->
      <p v-if="feedback" class="text-center text-xs" :class="feedbackOk ? 'text-green-400' : 'text-red-400'">
        {{ feedback }}
      </p>
    </div>

    <!-- ── Connect app over network ──────────────────────────────────────────── -->
    <div class="border-t border-zinc-800 px-4 py-3">
      <p class="mb-3 text-xs font-medium text-zinc-400 uppercase tracking-wide">
        Connect app over network
      </p>
      <div class="flex flex-col gap-3">
        <!-- Device IP -->
        <div class="flex flex-col gap-1">
          <label class="text-xs text-muted-foreground">Device IP</label>
          <Input
            v-model="netIp"
            placeholder="192.168.1.x"
            :disabled="netConnecting || netConnected"
            class="bg-zinc-900 font-mono"
          />
        </div>

        <!-- PSK (pre-shared key) -->
        <div class="flex flex-col gap-1">
          <label class="text-xs text-muted-foreground">PSK (pre-shared key)</label>
          <div class="relative">
            <Input
              v-model="netPsk"
              :type="showNetPsk ? 'text' : 'password'"
              placeholder="Device PSK"
              :disabled="netConnecting || netConnected"
              class="bg-zinc-900 pr-9"
            />
            <button
              type="button"
              class="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-zinc-100"
              tabindex="-1"
              @click="showNetPsk = !showNetPsk"
            >
              <component :is="showNetPsk ? EyeOff : Eye" class="size-4" />
            </button>
          </div>
        </div>

        <!-- Connect / Disconnect button -->
        <Button
          v-if="!netConnected"
          :disabled="netConnecting || !netIp.trim() || !netPsk.trim()"
          class="w-full"
          @click="connectNet"
        >
          <component :is="netConnecting ? Loader2 : NetworkIcon" class="mr-2 size-4" :class="netConnecting ? 'animate-spin' : ''" />
          {{ netConnecting ? 'Connecting…' : 'Connect' }}
        </Button>
        <Button
          v-else
          variant="destructive"
          class="w-full"
          @click="disconnectNet"
        >
          <NetworkIcon class="mr-2 size-4" />
          Disconnect ({{ netDeviceId }})
        </Button>

        <!-- Net connection status -->
        <p v-if="netFeedback" class="text-center text-xs" :class="netFeedbackOk ? 'text-green-400' : 'text-red-400'">
          {{ netFeedback }}
        </p>
      </div>
    </div>
  </ConfigSection>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Wifi, Eye, EyeOff, Wifi as WifiIcon, Network as NetworkIcon, Loader2 } from 'lucide-vue-next'
import ConfigSection from '@renderer/components/common/ConfigSection.vue'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { Button } from '@renderer/components/ui/button'
import { useDeviceStore } from '@renderer/deviceStore'

const deviceStore = useDeviceStore()

// ── Device WiFi credentials (sent to firmware) ────────────────────────────────
const ssid = ref(deviceStore.settings?.wifiSsid ?? '')
const password = ref(deviceStore.settings?.wifiPassword ?? '')
const wifiEnabled = ref(deviceStore.settings?.wifiEnabled ?? false)
const showPassword = ref(false)
const feedback = ref('')
const feedbackOk = ref(true)

// Keep form in sync if the store gets a fresh settings push from the device
// (e.g. on reconnect)
onMounted(() => {
  if (deviceStore.settings) {
    ssid.value = deviceStore.settings.wifiSsid ?? ''
    password.value = deviceStore.settings.wifiPassword ?? ''
    wifiEnabled.value = deviceStore.settings.wifiEnabled ?? false
  }
  // Restore the last network IP + PSK so WiFi connectivity persists across restarts.
  try {
    const ip = localStorage.getItem('net-last-ip') || ''
    netIp.value = ip
    if (ip) {
      const map = JSON.parse(localStorage.getItem('net-psk-map') || '{}')
      netPsk.value = map[ip] || ''
    }
  } catch {
    /* ignore corrupt localStorage */
  }
})

function connect() {
  feedback.value = ''
  deviceStore.setWifi(ssid.value, password.value, wifiEnabled.value)
  // Wait for ACK from firmware (FW3 contract)
  deviceStore._onAck('wifi', (ok, err) => {
    feedbackOk.value = ok
    feedback.value = ok ? 'Settings sent to device.' : (err ?? 'Failed.')
  })
}

// ── Connect app over network (TCP/WiFi to device) ────────────────────────────
const netIp = ref('')
const netPsk = ref('')
const showNetPsk = ref(false)
const netConnecting = ref(false)
const netConnected = ref(false)
const netDeviceId = ref('')
const netFeedback = ref('')
const netFeedbackOk = ref(true)

async function connectNet() {
  netFeedback.value = ''
  netConnecting.value = true
  try {
    const deviceId = await window.nanoIpc.connectNet(netIp.value.trim(), netPsk.value)
    // On success the 'connected' event fires through the existing nanoSerialApi:event
    // channel, which triggers deviceStore.connectDevice + profiles/settings query.
    netDeviceId.value = deviceId
    netConnected.value = true
    netFeedbackOk.value = true
    netFeedback.value = 'Connected as ' + deviceId
    // Persist IP + PSK so this connection is remembered (one-click reconnect).
    try {
      const ip = netIp.value.trim()
      localStorage.setItem('net-last-ip', ip)
      const map = JSON.parse(localStorage.getItem('net-psk-map') || '{}')
      map[ip] = netPsk.value
      localStorage.setItem('net-psk-map', JSON.stringify(map))
    } catch {
      /* ignore */
    }
  } catch (err: unknown) {
    netFeedbackOk.value = false
    netFeedback.value = err instanceof Error ? err.message : String(err)
  } finally {
    netConnecting.value = false
  }
}

async function disconnectNet() {
  netFeedback.value = ''
  try {
    await window.nanoIpc.disconnectNet(netDeviceId.value)
    netConnected.value = false
    netDeviceId.value = ''
    netFeedbackOk.value = true
    netFeedback.value = 'Disconnected.'
  } catch (err: unknown) {
    netFeedbackOk.value = false
    netFeedback.value = err instanceof Error ? err.message : String(err)
  }
}
</script>
