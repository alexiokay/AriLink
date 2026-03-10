<template>
  <div class="flow-node flow-node--http">
    <Handle type="target" :position="Position.Top" />
    <div class="flow-node__header">
      <UIcon name="i-lucide-globe" class="size-3.5" />
      <input
        v-model="data.label"
        class="flow-node__label"
        placeholder="HTTP Request"
        @mousedown.stop
      />
      <span class="flow-node__badge flow-node__badge--http">HTTP</span>
    </div>
    <div class="flow-node__body">
      <div class="flex items-center gap-1.5">
        <select v-model="data.method" class="flow-node__select w-16 shrink-0" @mousedown.stop>
          <option>GET</option>
          <option>POST</option>
          <option>PUT</option>
          <option>DELETE</option>
        </select>
        <input
          v-model="data.url"
          class="flow-node__text-input font-mono"
          placeholder="https://api.example.com/check"
          @mousedown.stop
        />
      </div>
      <div class="flex items-center gap-1.5">
        <span class="text-[10px] text-(--ui-text-dimmed) shrink-0">Store →</span>
        <FlowVariablePicker v-model="data.resultVariable" placeholder="api_result" :node-id="nodeId" />
      </div>
      <div class="flex items-center gap-1.5">
        <span class="text-[10px] text-(--ui-text-dimmed) shrink-0">Headers:</span>
        <input
          v-model="data.headersJson"
          class="flow-node__text-input font-mono"
          placeholder='{"Authorization": "Bearer ..."}'
          @mousedown.stop
        />
      </div>
      <div v-if="data.method !== 'GET'" class="flex items-center gap-1.5">
        <span class="text-[10px] text-(--ui-text-dimmed) shrink-0">Body:</span>
        <input
          v-model="data.bodyJson"
          class="flow-node__text-input font-mono"
          placeholder='{"phone": "{{caller}}"}'
          @mousedown.stop
        />
      </div>

      <!-- Bottom handle labels -->
      <div class="http-bottom-labels">
        <span class="text-[9px] font-semibold text-red-500">error ↓</span>
        <span class="text-[9px] text-(--ui-text-dimmed)">↓ next</span>
      </div>
    </div>
    <Handle type="source" :position="Position.Bottom" id="error" :style="{ left: '35%' }" />
    <Handle type="source" :position="Position.Bottom" id="next" :style="{ left: '65%' }" />
  </div>
</template>

<script setup lang="ts">
import { Position, Handle } from '@vue-flow/core';
import FlowVariablePicker from './FlowVariablePicker.vue';

const props = defineProps<{ data: any; nodeId?: string }>();

if (!props.data.method) props.data.method = 'GET';
if (!props.data.url) props.data.url = '';
if (!props.data.resultVariable) props.data.resultVariable = '';
if (!props.data.headersJson) props.data.headersJson = '';
if (!props.data.bodyJson) props.data.bodyJson = '';
</script>

<style scoped>
.http-bottom-labels {
  display: flex;
  justify-content: space-around;
  padding-top: 4px;
  border-top: 1px solid var(--ui-border);
}
</style>
