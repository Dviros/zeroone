<template>
  <div class="p-4">
    <span class="font-mono text-sm text-muted-foreground">Direction:</span>
    <div class="mt-2 flex gap-2">
      <Button
        v-for="opt in directionOptions"
        :key="opt.value"
        class="flex-1"
        :class="{
          'border border-zinc-200 bg-zinc-300 text-black': direction === opt.value,
          'border border-zinc-800 bg-transparent text-muted-foreground hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-300':
            direction !== opt.value
        }"
        @click="setDirection(opt.value)"
      >
        {{ opt.label }}
      </Button>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@renderer/components/ui/button'

const props = defineProps({
  value: {
    type: Object,
    required: true
  }
})
const emit = defineEmits(['update'])

// 'direction' maps to a subfield controlling next/prev/wrap behaviour
const direction = computed(() => props.value?.direction ?? 'next')

const directionOptions = [
  { value: 'next', label: 'Next' },
  { value: 'prev', label: 'Prev' },
  { value: 'wrap', label: 'Wrap' }
]

const setDirection = (val: string) => {
  emit('update', { direction: val })
}
</script>
