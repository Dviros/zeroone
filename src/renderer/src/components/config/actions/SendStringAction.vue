<template>
  <div class="p-4">
    <span class="font-mono text-sm text-muted-foreground">String to type:</span>
    <Input
      v-model="stringValue"
      type="text"
      placeholder="String to be typed"
      class="mt-2"
      @update:model-value="onInput"
    />
  </div>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue'
import { Input } from '@renderer/components/ui/input'

const props = defineProps({
  action: {
    type: Object,
    required: true
  }
})
const emit = defineEmits(['update'])

const stringValue = ref(props.action?.str ?? '')

// Sync if parent replaces the action object (e.g. profile switch)
watch(
  () => props.action?.str,
  (val) => {
    stringValue.value = val ?? ''
  }
)

const onInput = (val: string) => {
  emit('update', { str: val })
}
</script>
