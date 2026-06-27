<template>
  <ConfigSection title="macOS Actions" :icon-component="Apple" :foldable="false">
    <div class="flex flex-col divide-y divide-zinc-800">
      <!-- Button rows -->
      <div
        v-for="(btn, idx) in buttons"
        :key="idx"
        class="flex items-center gap-3 px-4 py-3"
      >
        <span class="w-16 shrink-0 font-mono text-xs text-muted-foreground">
          Button {{ ['A', 'B', 'C', 'D'][idx] }}
        </span>
        <select
          :value="btn"
          class="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          @change="setButton(idx, ($event.target as HTMLSelectElement).value)"
        >
          <option
            v-for="opt in BUTTON_OPTIONS"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </option>
        </select>
      </div>

      <!-- Knob volume toggle -->
      <div class="flex items-center justify-between px-4 py-3">
        <span class="text-sm text-zinc-300">Knob controls macOS volume</span>
        <Switch :checked="knobVolume" @update:checked="setKnobVolume($event)" />
      </div>

      <!-- Album art toggle -->
      <div class="flex items-center justify-between px-4 py-3">
        <span class="text-sm text-zinc-300">Album art on screen</span>
        <Switch :checked="artwork" @update:checked="setArtwork($event)" />
      </div>

      <!-- Feedback -->
      <div v-if="feedback" class="px-4 py-2">
        <p class="text-xs" :class="feedbackOk ? 'text-green-400' : 'text-red-400'">
          {{ feedback }}
        </p>
      </div>
    </div>
  </ConfigSection>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import ConfigSection from '@renderer/components/common/ConfigSection.vue'
import { Switch } from '@renderer/components/ui/switch'
// Lucide doesn't ship an Apple icon; use a generic terminal/monitor icon instead.
import { Monitor as Apple } from 'lucide-vue-next'

// ── Constants ─────────────────────────────────────────────────────────────────

const BUTTON_OPTIONS = [
  { value: 'playpause', label: 'Play / Pause' },
  { value: 'next',      label: 'Next Track' },
  { value: 'previous',  label: 'Previous Track' },
  { value: 'mute',      label: 'Mute' },
  { value: 'volup',     label: 'Volume Up' },
  { value: 'voldown',   label: 'Volume Down' },
  { value: 'none',      label: 'None' },
] as const

type ButtonAction = typeof BUTTON_OPTIONS[number]['value']

const CONFIG_PATH = '~/.config/nanod/bridge.json'

// ── State ─────────────────────────────────────────────────────────────────────

// Default: A=playpause B=next C=previous D=mute
const buttons = ref<ButtonAction[]>(['playpause', 'next', 'previous', 'mute'])
const knobVolume = ref(true)
const artwork = ref(false)

const feedback = ref('')
const feedbackOk = ref(true)

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(async () => {
  try {
    const raw: string = await invoke('read_bridge_config')
    if (raw) {
      const cfg = JSON.parse(raw)
      if (Array.isArray(cfg.buttons)) {
        buttons.value = (cfg.buttons as string[]).slice(0, 4).map(
          (v) => (BUTTON_OPTIONS.some((o) => o.value === v) ? (v as ButtonAction) : 'none')
        ) as ButtonAction[]
        // Pad to 4 if the saved array is shorter
        while (buttons.value.length < 4) buttons.value.push('none')
      }
      if (typeof cfg.knobVolume === 'boolean') knobVolume.value = cfg.knobVolume
      if (typeof cfg.artwork === 'boolean') artwork.value = cfg.artwork
    }
  } catch {
    // File missing or parse error — use defaults silently
  }
})

// ── Mutations ─────────────────────────────────────────────────────────────────

function setButton(idx: number, value: string) {
  buttons.value[idx] = value as ButtonAction
  persist()
}

function setKnobVolume(val: boolean) {
  knobVolume.value = val
  persist()
}

function setArtwork(val: boolean) {
  artwork.value = val
  persist()
}

async function persist() {
  const cfg = {
    buttons: buttons.value.slice(),
    knobVolume: knobVolume.value,
    artwork: artwork.value,
  }
  try {
    await invoke('write_bridge_config', { json: JSON.stringify(cfg) })
    feedbackOk.value = true
    feedback.value = 'Saved.'
    setTimeout(() => { feedback.value = '' }, 2000)
  } catch (err: unknown) {
    feedbackOk.value = false
    feedback.value = err instanceof Error ? err.message : String(err)
  }
}
</script>
