<template>
  <div class="flow-node flow-node--transfer">
    <Handle type="target" :position="Position.Top" />
    <div class="flow-node__header">
      <UIcon name="i-lucide-phone-forwarded" class="size-3.5" />
      <input
        v-model="data.label"
        class="flow-node__label"
        placeholder="Transfer"
        @mousedown.stop
      />
      <span class="flow-node__badge flow-node__badge--transfer">XFER</span>
    </div>
    <div class="flow-node__body">
      <div class="flex items-center gap-1.5">
        <span class="text-[10px] text-(--ui-text-dimmed) shrink-0">Ext:</span>
        <input
          v-model="data.extension"
          class="flow-node__text-input"
          placeholder="200"
          @mousedown.stop
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Position, Handle } from '@vue-flow/core';

defineProps<{ data: any }>();
</script>
