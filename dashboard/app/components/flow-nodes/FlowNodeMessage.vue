<template>
  <div class="flow-node flow-node--message" :class="{ 'flow-node--start': data.isStart }">
    <Handle type="target" :position="Position.Top" />
    <div class="flow-node__header">
      <UIcon name="i-lucide-message-circle" class="size-3.5" />
      <input
        v-model="data.label"
        class="flow-node__label"
        placeholder="Message"
        @mousedown.stop
      />
      <span class="flow-node__badge flow-node__badge--message">MSG</span>
    </div>
    <div class="flow-node__body">
      <FlowAudioPicker v-model="data.audio" :slug="data._slug" />
      <textarea
        v-model="data.text"
        class="flow-node__textarea"
        placeholder="TTS fallback text..."
        rows="2"
        @mousedown.stop
      />
    </div>
    <Handle type="source" :position="Position.Bottom" id="next" />
  </div>
</template>

<script setup lang="ts">
import { Position, Handle } from '@vue-flow/core';
import FlowAudioPicker from './FlowAudioPicker.vue';

defineProps<{ data: any }>();
</script>
