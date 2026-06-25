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
  </ConfigSection>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Wifi, Eye, EyeOff, Wifi as WifiIcon } from 'lucide-vue-next'
import ConfigSection from '@renderer/components/common/ConfigSection.vue'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { Button } from '@renderer/components/ui/button'
import { useDeviceStore } from '@renderer/deviceStore'

const deviceStore = useDeviceStore()

// Local form state — seeded from stored settings when available
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
</script>
