<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import { ref, watch } from 'vue'

const open = ref(false)

const show = () => {
  open.value = true
}

const props = defineProps({
  profile: {
    type: Object,
    default: () => ({
      id: '1234',
      name: 'PROFILE NAME',
      desc: 'PROFILE DESCRIPTION'
    }),
    required: true
  }
})

// Sync local copies when profile prop changes (profile switch while dialog open)
const nameInput = ref(props.profile.name)
const descriptionInput = ref(props.profile.desc)

watch(
  () => props.profile,
  (p) => {
    nameInput.value = p.name
    descriptionInput.value = p.desc
  }
)

const emit = defineEmits(['update:name', 'update:description'])

// Fixed: only emit on explicit Save, not on every keystroke
const save = () => {
  if (nameInput.value !== props.profile.name) {
    emit('update:name', nameInput.value)
  }
  if (descriptionInput.value !== props.profile.desc) {
    emit('update:description', descriptionInput.value)
  }
  open.value = false
}

const close = () => {
  // Discard local edits
  nameInput.value = props.profile.name
  descriptionInput.value = props.profile.desc
  open.value = false
}

defineExpose({ show })
</script>

<template>
  <Dialog :open="open" @update:open="(v) => (open = v)">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Profile properties</DialogTitle>
      </DialogHeader>
      <div>
        <span class="font-mono text-sm text-muted-foreground">Title:</span>
        <Input v-model="nameInput" class="my-2 uppercase" type="text" />
      </div>
      <div>
        <span class="font-mono text-sm text-muted-foreground">Description:</span>
        <Textarea v-model="descriptionInput" maxlength="40" class="my-2 max-h-64 uppercase" />
      </div>
      <!-- Fixed: added Save/Close buttons; was emitting on every keystroke with no way to dismiss -->
      <DialogFooter>
        <Button variant="outline" @click="close">Close</Button>
        <Button @click="save">Save</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
