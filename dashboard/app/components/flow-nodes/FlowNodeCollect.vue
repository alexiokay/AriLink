<template>
  <div class="flow-node flow-node--collect" :class="{ 'flow-node--start': data.isStart }">
    <Handle type="target" :position="Position.Top" />
    <div class="flow-node__header">
      <UIcon name="i-lucide-mic" class="size-3.5" />
      <input
        v-model="data.label"
        class="flow-node__label"
        placeholder="Collect"
        @mousedown.stop
      />
      <span class="flow-node__badge flow-node__badge--collect">VOICE</span>
    </div>
    <div class="flow-node__body">
      <FlowAudioPicker v-model="data.audio" :slug="data._slug" />
      <textarea
        v-model="data.text"
        class="flow-node__textarea"
        placeholder="Please say your name..."
        rows="2"
        @mousedown.stop
      />
      <div class="flex items-center gap-1.5">
        <span class="text-[10px] text-(--ui-text-dimmed) shrink-0">Variable:</span>
        <FlowVariablePicker v-model="data.variable" placeholder="name" :node-id="nodeId" />
      </div>
    </div>
    <Handle type="source" :position="Position.Bottom" id="next" />
  </div>
</template>

<script setup lang="ts">
import { Position, Handle } from '@vue-flow/core';
import FlowAudioPicker from './FlowAudioPicker.vue';
import FlowVariablePicker from './FlowVariablePicker.vue';

defineProps<{ data: any; nodeId?: string }>();
</script>
