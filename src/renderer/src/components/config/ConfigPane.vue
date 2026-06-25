<template>
  <div class="flex flex-col">
    <!-- Global panel nav: WiFi / Sprites / Integrations (always visible when connected) -->
    <div class="flex gap-1 border-b border-zinc-800 bg-zinc-900 px-2 py-1">
      <button
        v-for="panel in globalPanels"
        :key="panel.key"
        class="rounded px-2 py-0.5 font-mono text-xs transition-colors"
        :class="
          appStore.selectedFeature === panel.key
            ? 'bg-zinc-200 text-zinc-900'
            : 'text-muted-foreground hover:bg-zinc-800 hover:text-zinc-200'
        "
        @click="appStore.selectConfigFeature(panel.key)"
      >
        {{ panel.label }}
      </button>
    </div>

    <template v-if="isGlobalPanel">
      <!-- Global panels (wifi/sprites/integrations) have no sub-tabs -->
      <div class="grow overflow-y-auto">
        <component :is="appStore.currentConfigComponent" />
      </div>
    </template>
    <template v-else-if="deviceStore.currentProfile">
      <TabSelect
        v-if="showTabs"
        v-model="configPage"
        :options="configPages"
        class="solid border bg-zinc-900 p-2"
      >
        <template v-for="(page, key) in configPages" #[key] :key="key">
          <ScrambleText ref="title" :text="$t(page.titleKey)" />
        </template>
      </TabSelect>
      <div :key="deviceStore.currentProfileName" class="grow overflow-y-auto">
        <component :is="appStore.currentConfigComponent" />
      </div>
    </template>
    <template v-else>
      <div class="flex grow items-center justify-center pb-16 text-muted-foreground">
        <ChevronLeft class="mb-0.5 inline-block h-5" />
        <ScrambleText
          scramble-on-mount
          :fill-interval="5"
          :replace-interval="5"
          text="Select a profile first"
        />
      </div>
    </template>
  </div>
</template>
<script setup>
import { useAppStore } from '@renderer/appStore'
import { useDeviceStore } from '@renderer/deviceStore'
import TabSelect from '@renderer/components/common/TabSelect.vue'
import { computed } from 'vue'
import ScrambleText from '@renderer/components/common/ScrambleText.vue'
import { ChevronLeft } from 'lucide-vue-next'

const appStore = useAppStore()
const deviceStore = useDeviceStore()

// Features that are device-global (not profile-bound) — registered by APP3 via appStore
const GLOBAL_FEATURES = ['wifi', 'sprites', 'integrations']

const globalPanels = [
  { key: 'wifi', label: 'WiFi' },
  { key: 'sprites', label: 'Sprites' },
  { key: 'integrations', label: 'Integrations' }
]

const isGlobalPanel = computed(() => GLOBAL_FEATURES.includes(appStore.selectedFeature))

const configPages = computed(() => appStore.currentConfigPages)
const configPage = computed({
  get: () => appStore.currentConfigPage,
  set: (value) => appStore.setCurrentConfigPage(value)
})

defineProps({
  showTabs: {
    type: Boolean,
    default: true
  }
})
</script>
