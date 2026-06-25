<template>
  <ConfigSection title="Integrations" :icon-component="Plug" :foldable="false">
    <div class="flex flex-col divide-y divide-zinc-800">
      <div
        v-for="integration in integrations"
        :key="integration.id"
        class="flex flex-col gap-2 px-4 py-3"
      >
        <!-- Header row: icon + name + toggle -->
        <div class="flex items-center gap-2">
          <component :is="integration.icon" class="size-4 shrink-0 text-muted-foreground" />
          <span class="flex-1 text-sm text-zinc-200">{{ integration.label }}</span>
          <Switch
            :checked="states[integration.id]?.enabled ?? false"
            @update:checked="setEnabled(integration.id, $event)"
          />
        </div>

        <!-- Params (only when enabled) -->
        <template v-if="states[integration.id]?.enabled">
          <div
            v-for="param in integration.params"
            :key="param.key"
            class="flex flex-col gap-1 pl-6"
          >
            <label class="text-xs text-muted-foreground">{{ param.label }}</label>
            <Input
              v-model="states[integration.id].params[param.key]"
              :placeholder="param.placeholder"
              class="bg-zinc-900"
              @blur="pushIntegration(integration.id)"
            />
          </div>
          <div class="pl-6">
            <Button size="sm" variant="secondary" @click="pushIntegration(integration.id)">
              Apply
            </Button>
            <span
              v-if="feedback[integration.id]"
              class="ml-2 text-xs"
              :class="feedbackOk[integration.id] ? 'text-green-400' : 'text-red-400'"
            >
              {{ feedback[integration.id] }}
            </span>
          </div>
        </template>
      </div>
    </div>
  </ConfigSection>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import { Plug, Music, Keyboard, Globe } from 'lucide-vue-next'
import ConfigSection from '@renderer/components/common/ConfigSection.vue'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { Button } from '@renderer/components/ui/button'
import { useDeviceStore } from '@renderer/deviceStore'

const deviceStore = useDeviceStore()

// Static integration definitions — add more entries here as needed.
// Each param.key maps to a field in the params object sent to firmware.
const integrations = [
  {
    id: 'midi_clock',
    label: 'MIDI Clock Sync',
    icon: Music,
    params: [
      { key: 'bpm', label: 'BPM', placeholder: '120' }
    ]
  },
  {
    id: 'hid_extra',
    label: 'HID Extra Keys',
    icon: Keyboard,
    params: [] as { key: string; label: string; placeholder: string }[]
  },
  {
    id: 'http_webhook',
    label: 'HTTP Webhook',
    icon: Globe,
    params: [
      { key: 'url', label: 'URL', placeholder: 'http://...' },
      { key: 'token', label: 'Bearer Token (optional)', placeholder: '' }
    ]
  }
] as const

type IntegrationId = typeof integrations[number]['id']

// Per-integration reactive state
const states = reactive<
  Record<string, { enabled: boolean; params: Record<string, string> }>
>(
  Object.fromEntries(
    integrations.map((i) => [
      i.id,
      {
        enabled: false,
        params: Object.fromEntries(i.params.map((p) => [p.key, '']))
      }
    ])
  )
)

const feedback = reactive<Record<string, string>>({})
const feedbackOk = reactive<Record<string, boolean>>({})

function setEnabled(id: string, val: boolean) {
  states[id].enabled = val
  pushIntegration(id)
}

function pushIntegration(id: string) {
  feedback[id] = ''
  const { enabled, params } = states[id]
  // Convert param string values to the appropriate types (numbers where possible)
  const cleanParams: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(params)) {
    const n = Number(v)
    cleanParams[k] = v !== '' && !isNaN(n) ? n : v
  }
  deviceStore.setIntegration(id, enabled, cleanParams)
  deviceStore._onAck('integration', (ok, err) => {
    feedbackOk[id] = ok
    feedback[id] = ok ? 'Saved.' : (err ?? 'Failed.')
  })
}
</script>
