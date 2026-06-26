<template>
  <div class="flex flex-col p-4">
    <span class="font-mono text-sm text-muted-foreground">Media Key:</span>
    <div class="flex gap-2 py-2 flex-wrap">
      <Button
        v-for="preset in presets"
        :key="preset.usage"
        :class="{
          'border border-zinc-200 bg-zinc-300 text-black': selectedUsage === preset.usage,
          'border border-zinc-800 bg-transparent text-muted-foreground hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-300':
            selectedUsage !== preset.usage
        }"
        class="flex-1 text-xs"
        @click="selectPreset(preset.usage)"
      >
        {{ preset.label }}
      </Button>
    </div>
  </div>
</template>
<script setup lang="ts">
import { Action } from '@renderer/deviceStore'
import { Button } from '@renderer/components/ui/button'
import { ref, watch } from 'vue'

const emit = defineEmits(['update'])

const props = defineProps({
  action: {
    type: Object as () => Action,
    required: true
  }
})

const presets = [
  { label: 'Play / Pause', usage: 0xcd },
  { label: 'Next Track', usage: 0xb5 },
  { label: 'Prev Track', usage: 0xb6 },
  { label: 'Mute', usage: 0xe2 },
  { label: 'Volume Up', usage: 0xe9 },
  { label: 'Volume Down', usage: 0xea }
]

const selectedUsage = ref<number>(props.action.usage ?? 0xcd)

watch(selectedUsage, (usage) => {
  emit('update', { usage })
})

function selectPreset(usage: number) {
  selectedUsage.value = usage
  emit('update', { usage })
}
</script>
