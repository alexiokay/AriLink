<template>
  <div class="flow-node flow-node--condition" :class="{ 'flow-node--start': data.isStart }">
    <Handle type="target" :position="Position.Top" />
    <div class="flow-node__header">
      <UIcon name="i-lucide-git-branch" class="size-3.5" />
      <input
        v-model="data.label"
        class="flow-node__label"
        placeholder="Condition"
        @mousedown.stop
      />
      <span class="flow-node__badge flow-node__badge--condition">IF</span>
    </div>
    <div class="flow-node__body">
      <div class="flex items-center gap-1.5">
        <span class="text-[10px] text-(--ui-text-dimmed) shrink-0">Var:</span>
        <FlowVariablePicker v-model="data.variable" placeholder="name" :node-id="nodeId" />
      </div>
      <div class="flex items-center gap-1.5">
        <UIcon name="i-lucide-equal" class="size-3 text-(--ui-text-dimmed) shrink-0" />
        <select v-model="data.operator" class="flow-node__select" @mousedown.stop>
          <option value="equals">equals</option>
          <option value="not_equals">not equals</option>
          <option value="contains">contains</option>
          <option value="not_empty">not empty</option>
          <option value="empty">is empty</option>
          <option value="gt">greater than</option>
          <option value="lt">less than</option>
        </select>
      </div>
      <div v-if="!['empty', 'not_empty'].includes(data.operator)" class="flex items-center gap-1.5">
        <span class="text-[10px] text-(--ui-text-dimmed) shrink-0">Value:</span>
        <input
          v-model="data.compareValue"
          class="flow-node__text-input font-mono"
          placeholder="yes"
          @mousedown.stop
        />
      </div>

      <!-- Branch labels -->
      <div class="condition-bottom-labels">
        <span class="text-[10px] font-semibold text-green-500">TRUE ↓</span>
        <span class="text-[10px] font-semibold text-red-500">↓ FALSE</span>
      </div>
    </div>

    <!-- Bottom handles on node border, spaced apart -->
    <Handle type="source" :position="Position.Bottom" id="true" :style="{ left: '35%' }" />
    <Handle type="source" :position="Position.Bottom" id="false" :style="{ left: '65%' }" />
  </div>
</template>

<script setup lang="ts">
import { Position, Handle } from '@vue-flow/core';
import FlowVariablePicker from './FlowVariablePicker.vue';

const props = defineProps<{ data: any; nodeId?: string }>();

// Defaults
if (!props.data.operator) props.data.operator = 'equals';
if (!props.data.compareValue) props.data.compareValue = '';
if (!props.data.variable) props.data.variable = '';
</script>

<style scoped>
.condition-bottom-labels {
  display: flex;
  justify-content: space-around;
  padding-top: 4px;
  border-top: 1px solid var(--ui-border);
}
</style>
