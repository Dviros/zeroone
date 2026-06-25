import { defineStore } from 'pinia'
import WIP from '@renderer/components/WIP.vue'
import KnobFeedbackConfig from '@renderer/components/config/knob/KnobFeedbackConfig.vue'
import KnobLightConfig from '@renderer/components/config/knob/KnobLightConfig.vue'
import KeyLightConfig from '@renderer/components/config/keys/KeyLightConfig.vue'
import KnobMappingConfig from '@renderer/components/config/knob/KnobMappingConfig.vue'
import KeyMappingConfig from '@renderer/components/config/keys/KeyMappingConfig.vue'
import { shallowRef } from 'vue'
import KeyFeedbackConfig from './components/config/keys/KeyFeedbackConfig.vue'
// APP3-owned panels — imported by contract path
import WiFiConfig from '@renderer/components/config/wifi/WiFiConfig.vue'
import SpriteConfig from '@renderer/components/config/sprites/SpriteConfig.vue'
import IntegrationsConfig from '@renderer/components/config/integrations/IntegrationsConfig.vue'

export const useAppStore = defineStore('app', {
  state: () => {
    return {
      selectedFeature: 'knob',
      selectedKey: 'a',
      currentConfigPage: 'mapping',
      configPages: {
        knob: {
          mapping: {
            titleKey: 'config_options.mapping_configuration.title',
            component: shallowRef(KnobMappingConfig)
          },
          feedback: {
            titleKey: 'config_options.feedback_designer.title',
            component: shallowRef(KnobFeedbackConfig)
          },
          lighting: {
            titleKey: 'config_options.light_designer.title',
            component: shallowRef(KnobLightConfig)
          }
        },
        key: {
          mapping: {
            titleKey: 'config_options.mapping_configuration.title',
            component: shallowRef(KeyMappingConfig)
          },
          feedback: {
            titleKey: 'config_options.feedback_designer.title',
            component: shallowRef(KeyFeedbackConfig)
          },
          lighting: {
            titleKey: 'config_options.light_designer.title',
            component: shallowRef(KeyLightConfig)
          }
        },
        // Global device-level panels (APP3-owned components, registered here per contract)
        wifi: {
          main: {
            titleKey: 'config_options.wifi.title',
            component: shallowRef(WiFiConfig)
          }
        },
        sprites: {
          main: {
            titleKey: 'config_options.sprites.title',
            component: shallowRef(SpriteConfig)
          }
        },
        integrations: {
          main: {
            titleKey: 'config_options.integrations.title',
            component: shallowRef(IntegrationsConfig)
          }
        }
      },
      previewDeviceModel: localStorage.getItem('previewDeviceModel') || 'nanoOne',
      profileManagerDragging: false,
      showProfileConfig: false,
      selectOnInput: false
    }
  },
  getters: {
    currentConfigComponent: (state) =>
      state.configPages[state.selectedFeature][state.currentConfigPage]?.component || WIP,
    currentConfigPages: (state) => state.configPages[state.selectedFeature] || {}
  },
  actions: {
    selectConfigFeature(feature) {
      this.selectedFeature = feature
      // Global panels ('wifi','sprites','integrations') have only a 'main' sub-page
      if (!this.currentConfigPages[this.currentConfigPage]) {
        const firstPage = Object.keys(this.currentConfigPages)[0] || 'mapping'
        this.setCurrentConfigPage(firstPage)
      }
    },
    selectKey(key) {
      this.selectedKey = key
      this.selectConfigFeature('key')
    },
    setCurrentConfigPage(page) {
      this.currentConfigPage = page
    },
    switchPreviewDeviceModel() {
      this.previewDeviceModel = this.previewDeviceModel === 'nanoOne' ? 'nanoZero' : 'nanoOne'
      localStorage.setItem('previewDeviceModel', this.previewDeviceModel)
    },
    setProfileManagerDragging(dragging) {
      this.profileManagerDragging = dragging
    },
    setShowProfileConfig(show) {
      // Fixed: was always overwriting arg with false, so profile panel never opened
      this.showProfileConfig = show
    },
    toggleSelectOnInput() {
      this.selectOnInput = !this.selectOnInput
    }
  }
})
