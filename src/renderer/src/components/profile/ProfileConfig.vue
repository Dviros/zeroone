<template>
  <ConfigSection
    :title="$t('config_options.profile_settings.profile_properties.title')"
    :icon-component="Type"
  >
    <div class="my-4 px-8">
      <span class="font-mono text-sm text-muted-foreground">Title</span>
      <!-- Fixed: was hardcoded default-value; now v-model bound to current profile name -->
      <Input
        v-model="profileName"
        class="font-pixelsm mt-2 uppercase"
        @blur="commitName"
        @keydown.enter="commitName"
      />
    </div>
    <div class="my-4 px-8">
      <span class="font-mono text-sm text-muted-foreground">Description</span>
      <!-- Fixed: was hardcoded default-value; now v-model bound to current profile desc -->
      <Textarea
        v-model="profileDesc"
        class="font-pixelsm mt-2 uppercase"
        @blur="commitDesc"
      />
    </div>
  </ConfigSection>

  <!-- connectionType section removed: was v-if=false dead code -->

  <ConfigSection
    :title="$t('config_options.profile_settings.internal_profile_toggle.title')"
    :icon-component="Replace"
    :show-toggle="true"
  >
    <p class="flex flex-col p-8 py-4 text-xs text-muted-foreground">
      {{ $t('config_options.profile_settings.internal_profile_toggle.subtitle') }}
      <Separator class="mt-4" />
      <span class="space-y-4 py-4"
        >{{ $t('config_options.profile_settings.internal_profile_toggle.operation') }}:<br />
        <Badge class="bg-orange-500">SHIFT</Badge> + <Badge class="bg-zinc-500">Fn3</Badge> +
        <Badge>Rotation</Badge></span
      >
      <Separator />
      <span class="pt-4">{{
        $t('config_options.profile_settings.internal_profile_toggle.warning')
      }}</span>
    </p>
  </ConfigSection>
</template>
<script setup>
import { Replace, Type } from 'lucide-vue-next'
import ConfigSection from '@renderer/components/common/ConfigSection.vue'
import { Separator } from '@renderer/components/ui/separator'
import { ref, watch } from 'vue'
import { Badge } from '@renderer/components/ui/badge'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import { useDeviceStore } from '@renderer/deviceStore'

const deviceStore = useDeviceStore()

// Local refs mirror the current profile; committed on blur/enter to avoid spamming the device
const profileName = ref(deviceStore.currentProfile?.name ?? '')
const profileDesc = ref(deviceStore.currentProfile?.desc ?? '')

// Keep local refs in sync when the selected profile changes externally
watch(
  () => deviceStore.currentProfile,
  (profile) => {
    profileName.value = profile?.name ?? ''
    profileDesc.value = profile?.desc ?? ''
  }
)

const commitName = () => {
  const newName = profileName.value.trim()
  const oldName = deviceStore.currentProfileName
  if (newName && newName !== oldName) {
    deviceStore.renameProfile(oldName, newName)
  }
}

const commitDesc = () => {
  if (deviceStore.currentProfileName) {
    deviceStore.updateProfileDescription(deviceStore.currentProfileName, profileDesc.value)
  }
}
</script>
