<template>
  <svg :viewBox="`0 0 ${size} ${size}`" filter="url(#blur)">
    <!-- Explicit, oversized filter region so the glow isn't clipped; valid
         identifier result names ("b1".."b5") — numeric names ("1".."5") are
         invalid SVG filter references and render as garbage in WebKit/WKWebView
         (Tauri) even though Chromium (the old Electron shell) tolerated them. -->
    <filter
      id="blur"
      x="-50%"
      y="-50%"
      width="200%"
      height="200%"
      color-interpolation-filters="sRGB"
    >
      <feGaussianBlur
        v-for="index in blurSteps"
        :key="index"
        in="SourceGraphic"
        :stdDeviation="blur * index"
        :result="`b${index}`"
      />
      <feMerge result="blurMerge">
        <feMergeNode v-for="index in blurSteps" :key="index" :in="`b${index}`" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
    <circle
      v-for="index in ledCount"
      :key="index"
      :transform="`rotate(${(index / ledCount) * 360 + rotationOffset} ${size / 2} ${size / 2})`"
      :r="ledRadius"
      :cx="size / 2"
      :cy="padding + ledRadius"
      :fill="colorToLED(leds[index - 1])?.hex()"
    />
  </svg>
</template>
<script setup>
import { computed, ref, watch } from 'vue'
import Color from 'color'
import { colorToLED } from '@renderer/colorToLED'
import { useDeviceStore } from '@renderer/deviceStore'

const deviceStore = useDeviceStore()

const props = defineProps({
  value: {
    type: Number,
    default: 0
  }
})

const leds = ref(Array(60).fill(Color()))

const radius = ref(100)
const ledRadius = ref(3)
const ledCount = ref(60)
const blur = ref(2)
const blurSteps = ref(5)
const padding = ref(40)
const rotationOffset = ref(180)

const size = computed(() => (radius.value + ledRadius.value + padding.value) * 2)

const updateLEDs = (value) => {
  const clamped = Math.min(98, Math.max(0, value))
  for (let i = 0; i < ledCount.value; i++) {
    if (i / ledCount.value < clamped / 100) {
      leds.value[i] = Color(deviceStore.currentProfile?.primary)
    } else if ((i - 1) / ledCount.value < clamped / 100) {
      leds.value[i] = Color(deviceStore.currentProfile?.pointer)
    } else {
      leds.value[i] = Color(deviceStore.currentProfile?.secondary)
    }
  }
}

updateLEDs(props.value)

watch(
  () => [
    deviceStore.currentProfile?.primary,
    deviceStore.currentProfile?.pointer,
    deviceStore.currentProfile?.secondary,
    props.value
  ],
  () => updateLEDs(props.value)
)
</script>
