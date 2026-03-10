<template>
  <div class="flow-node flow-node--hangup">
    <Handle type="target" :position="Position.Top" />
    <div class="flow-node__header">
      <UIcon name="i-lucide-phone-off" class="size-3.5" />
      <input
        v-model="data.label"
        class="flow-node__label"
        placeholder="Hangup"
        @mousedown.stop
      />
      <span class="flow-node__badge flow-node__badge--hangup">END</span>
    </div>
    <div class="flow-node__body">
      <FlowAudioPicker v-model="data.audio" :slug="data._slug" />
      <textarea
        v-model="data.text"
        class="flow-node__textarea"
        placeholder="Goodbye message (optional)..."
        rows="1"
        @mousedown.stop
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Position, Handle } from '@vue-flow/core';
import FlowAudioPicker from './FlowAudioPicker.vue';

defineProps<{ data: any }>();
</script>
