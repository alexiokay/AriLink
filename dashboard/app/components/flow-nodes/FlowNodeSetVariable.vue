<template>
  <div class="flow-node flow-node--set-variable">
    <Handle type="target" :position="Position.Top" />
    <div class="flow-node__header">
      <UIcon name="i-lucide-variable" class="size-3.5" />
      <input
        v-model="data.label"
        class="flow-node__label"
        placeholder="Set Variable"
        @mousedown.stop
      />
      <span class="flow-node__badge flow-node__badge--set-variable">SET</span>
    </div>
    <div class="flow-node__body">
      <div class="flex items-center gap-1.5">
        <span class="text-[10px] text-(--ui-text-dimmed) shrink-0">Name:</span>
        <FlowVariablePicker v-model="data.variable" placeholder="status" :node-id="nodeId" />
      </div>
      <div class="flex items-center gap-1.5">
        <span class="text-[10px] text-(--ui-text-dimmed) shrink-0">Value:</span>
        <input
          v-model="data.value"
          class="flow-node__text-input font-mono"
          placeholder="confirmed"
          @mousedown.stop
        />
      </div>
      <p class="text-[9px] text-(--ui-text-dimmed)">Use {{variable}} to reference other variables</p>
    </div>
    <Handle type="source" :position="Position.Bottom" id="next" />
  </div>
</template>

<script setup lang="ts">
import { Position, Handle } from '@vue-flow/core';
import FlowVariablePicker from './FlowVariablePicker.vue';

const props = defineProps<{ data: any; nodeId?: string }>();

if (!props.data.variable) props.data.variable = '';
if (!props.data.value) props.data.value = '';
</script>
