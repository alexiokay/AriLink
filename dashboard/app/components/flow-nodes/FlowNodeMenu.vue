<template>
  <div class="flow-node flow-node--menu" :class="{ 'flow-node--start': data.isStart }">
    <Handle type="target" :position="Position.Top" />
    <div class="flow-node__header">
      <UIcon name="i-lucide-list" class="size-3.5" />
      <input
        v-model="data.label"
        class="flow-node__label"
        placeholder="Menu"
        @mousedown.stop
      />
      <span class="flow-node__badge flow-node__badge--menu">MENU</span>
    </div>
    <div class="flow-node__body">
      <FlowAudioPicker v-model="data.audio" :slug="data._slug" />
      <textarea
        v-model="data.text"
        class="flow-node__textarea"
        placeholder="Press 1 for..., 2 for..."
        rows="2"
        @mousedown.stop
      />

      <!-- DTMF option rows with handles on the right border -->
      <div class="menu-options">
        <div class="menu-options__header">
          <span class="text-[10px] font-semibold text-(--ui-text-dimmed) uppercase">DTMF Keys</span>
          <button class="flow-node__add-btn" @click.stop="addOption" @mousedown.stop>+</button>
        </div>
        <div v-for="(opt, idx) in optionKeys" :key="idx" class="menu-option-row">
          <input
            v-model="optionKeys[idx]"
            class="flow-node__key-input"
            placeholder="#"
            maxlength="1"
            @mousedown.stop
            @change="syncOptions"
          />
          <button class="flow-node__remove-btn" @click.stop="removeOption(idx)" @mousedown.stop>×</button>
          <!-- Key label + handle pinned to right edge (only when key is set) -->
          <div v-if="opt" class="menu-option-port">
            <span class="menu-option-port__label">{{ opt }}</span>
            <Handle
              type="source"
              :position="Position.Right"
              :id="`opt-${opt}`"
              class="menu-option-port__handle"
            />
          </div>
          <span v-else class="text-[9px] text-(--ui-text-dimmed) ml-auto">set key</span>
        </div>
      </div>

      <!-- Timeout -->
      <div class="flow-node__timeout">
        <span class="text-[10px] text-(--ui-text-dimmed)">Timeout:</span>
        <input
          v-model.number="data.timeout.seconds"
          type="number"
          min="1"
          max="60"
          class="flow-node__num-input"
          @mousedown.stop
        />
        <span class="text-[10px] text-(--ui-text-dimmed)">s ×</span>
        <input
          v-model.number="data.timeout.retries"
          type="number"
          min="1"
          max="10"
          class="flow-node__num-input"
          @mousedown.stop
        />
      </div>

      <!-- Bottom handle label -->
      <div class="menu-bottom-labels">
        <span class="text-[9px] text-(--ui-text-dimmed)">timeout ↓</span>
      </div>
    </div>

    <!-- Bottom handle: timeout fallback -->
    <Handle type="source" :position="Position.Bottom" id="timeout" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { Position, Handle } from '@vue-flow/core';
import FlowAudioPicker from './FlowAudioPicker.vue';

const props = defineProps<{ data: any }>();

if (!props.data.timeout) {
  props.data.timeout = { seconds: 10, retries: 3 };
}

const optionKeys = ref<string[]>(Object.keys(props.data.options || {}));

function syncOptions() {
  const newOptions: Record<string, string> = {};
  for (const key of optionKeys.value) {
    if (key) {
      newOptions[key] = props.data.options?.[key] || '';
    }
  }
  props.data.options = newOptions;
}

function addOption() {
  const next = String(optionKeys.value.length + 1);
  optionKeys.value.push(next.length === 1 ? next : '');
  syncOptions();
}

function removeOption(idx: number) {
  optionKeys.value.splice(idx, 1);
  syncOptions();
}

watch(() => props.data.options, (opts) => {
  if (opts) optionKeys.value = Object.keys(opts);
}, { deep: true });
</script>

<style scoped>
.menu-options {
  border-top: 1px solid var(--ui-border);
  padding-top: 6px;
}
.menu-options__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.menu-option-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 3px;
  position: relative;
  padding-right: 20px; /* room for port label on edge */
}

/* Port label + handle pinned to the right edge of the node */
.menu-option-port {
  position: absolute;
  right: -10px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 2px;
}
.menu-option-port__label {
  font-size: 9px;
  font-weight: 700;
  color: var(--ui-primary);
  background: var(--ui-bg-elevated);
  padding: 0 2px;
  border-radius: 2px;
  line-height: 1.2;
}
/* Let vue-flow position the handle naturally on the right border;
   we just need it to sit inside our port container */
.menu-option-port__handle {
  position: relative !important;
  top: auto !important;
  right: auto !important;
  transform: none !important;
}

.menu-bottom-labels {
  display: flex;
  justify-content: center;
  padding-top: 4px;
  border-top: 1px solid var(--ui-border);
}
</style>
