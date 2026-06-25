<template>
  <ConfigSection title="Sprites" :icon-component="Image" :foldable="false">
    <div class="flex flex-col gap-3 px-4 py-3">

      <!-- Upload area -->
      <div
        class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-zinc-700 py-6 text-muted-foreground transition-colors hover:border-zinc-500 hover:bg-zinc-800/40"
        @click="fileInput?.click()"
        @dragover.prevent
        @drop.prevent="onDrop"
      >
        <Upload class="size-6" />
        <span class="text-xs">Click or drop a PNG to upload</span>
        <input
          ref="fileInput"
          type="file"
          accept=".png,image/png"
          class="hidden"
          @change="onFileChange"
        />
      </div>

      <!-- Preview + progress -->
      <template v-if="previewUrl || uploading">
        <div class="flex items-center gap-3">
          <img
            v-if="previewUrl"
            :src="previewUrl"
            class="size-12 rounded border border-zinc-700 object-contain"
            alt="preview"
          />
          <div class="flex flex-1 flex-col gap-1">
            <span class="truncate text-xs text-zinc-300">{{ pendingFile?.name }}</span>
            <div v-if="uploading" class="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                class="h-full rounded-full bg-zinc-100 transition-all"
                :style="{ width: `${Math.round(uploadProgress * 100)}%` }"
              />
            </div>
            <span v-if="uploading" class="text-xs text-muted-foreground">
              {{ Math.round(uploadProgress * 100) }}%
            </span>
          </div>
        </div>
        <Button
          :disabled="uploading || !pendingFile || !deviceStore.connected"
          class="w-full"
          @click="doUpload"
        >
          <Upload class="mr-2 size-4" />
          {{ uploading ? 'Uploading…' : 'Upload' }}
        </Button>
        <p v-if="uploadFeedback" class="text-center text-xs" :class="uploadOk ? 'text-green-400' : 'text-red-400'">
          {{ uploadFeedback }}
        </p>
      </template>

      <!-- Sprite list -->
      <div class="flex items-center justify-between">
        <span class="text-xs text-muted-foreground">Stored sprites</span>
        <button
          class="text-xs text-zinc-400 hover:text-zinc-100"
          @click="deviceStore.requestSpriteList()"
        >
          Refresh
        </button>
      </div>

      <div v-if="deviceStore.sprites.length === 0" class="py-2 text-center text-xs text-zinc-600">
        No sprites on device
      </div>

      <ul v-else class="flex flex-col gap-1">
        <li
          v-for="sprite in deviceStore.sprites"
          :key="sprite.name"
          class="flex items-center gap-2 rounded px-2 py-1.5 text-sm"
          :class="isActive(sprite.name) ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800'"
        >
          <!-- Thumbnail placeholder — actual render would require device image data -->
          <span class="flex size-8 shrink-0 items-center justify-center rounded border border-zinc-700 bg-zinc-900 text-[10px] text-muted-foreground">PNG</span>
          <span class="flex-1 truncate font-mono text-xs">{{ sprite.name }}</span>
          <span v-if="sprite.size" class="text-[10px] text-muted-foreground">{{ formatBytes(sprite.size) }}</span>
          <button
            class="ml-1 rounded p-1 text-zinc-500 hover:text-zinc-100"
            title="Set active"
            @click="deviceStore.selectSprite(sprite.name)"
          >
            <Check class="size-3" :class="isActive(sprite.name) ? 'text-green-400' : ''" />
          </button>
          <button
            class="rounded p-1 text-zinc-500 hover:text-red-400"
            title="Delete"
            @click="deviceStore.deleteSprite(sprite.name)"
          >
            <Trash2 class="size-3" />
          </button>
        </li>
      </ul>
    </div>
  </ConfigSection>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Image, Upload, Check, Trash2 } from 'lucide-vue-next'
import ConfigSection from '@renderer/components/common/ConfigSection.vue'
import { Button } from '@renderer/components/ui/button'
import { useDeviceStore } from '@renderer/deviceStore'

const deviceStore = useDeviceStore()

const fileInput = ref<HTMLInputElement | null>(null)
const pendingFile = ref<File | null>(null)
const previewUrl = ref<string | null>(null)
const uploading = ref(false)
const uploadProgress = ref(0)
const uploadFeedback = ref('')
const uploadOk = ref(true)

onMounted(() => {
  // Pull current sprite list on mount
  if (deviceStore.connected) deviceStore.requestSpriteList()
})

function isActive(name: string): boolean {
  return deviceStore.settings?.activeSprite === name
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  return `${(n / 1024).toFixed(1)}KB`
}

function setFile(file: File) {
  pendingFile.value = file
  uploadFeedback.value = ''
  const url = URL.createObjectURL(file)
  previewUrl.value = url
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.[0]) setFile(input.files[0])
}

function onDrop(e: DragEvent) {
  const file = e.dataTransfer?.files?.[0]
  if (file?.type === 'image/png') setFile(file)
}

async function doUpload() {
  if (!pendingFile.value) return
  uploading.value = true
  uploadProgress.value = 0
  uploadFeedback.value = ''
  try {
    await deviceStore.uploadSprite(pendingFile.value, (p) => {
      uploadProgress.value = p
    })
    // Register for ACK from firmware end-of-upload confirmation
    deviceStore._onAck('sprite', (ok, err) => {
      uploadOk.value = ok
      uploadFeedback.value = ok ? 'Upload complete.' : (err ?? 'Upload failed.')
      if (ok) deviceStore.requestSpriteList()
    })
  } catch (err) {
    uploadOk.value = false
    uploadFeedback.value = String(err)
  } finally {
    uploading.value = false
  }
}
</script>
