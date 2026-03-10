<template>
  <div class="flow-node flow-node--trigger">
    <div class="flow-node__header">
      <UIcon name="i-lucide-phone-incoming" class="size-3.5" />
      <span class="flow-node__label" style="cursor: default">Call Start</span>
      <span class="flow-node__badge flow-node__badge--trigger">TRIGGER</span>
    </div>
    <div class="flow-node__body">
      <p class="text-[10px] font-semibold text-(--ui-text-dimmed) uppercase mb-1">Built-in Variables</p>
      <div class="trigger-vars">
        <span class="trigger-var"><code>{{caller}}</code> caller ID</span>
        <span class="trigger-var"><code>{{extension}}</code> dialed ext</span>
        <span class="trigger-var"><code>{{date}}</code> current date</span>
        <span class="trigger-var"><code>{{time}}</code> current time</span>
        <span class="trigger-var"><code>{{digit}}</code> last DTMF</span>
      </div>
    </div>
    <Handle type="source" :position="Position.Bottom" id="next" />
  </div>
</template>

<script setup lang="ts">
import { Position, Handle } from '@vue-flow/core';

defineProps<{ data: any }>();
</script>

<style scoped>
.trigger-vars {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.trigger-var {
  font-size: 9px;
  color: var(--ui-text-muted);
  display: flex;
  align-items: center;
  gap: 4px;
}
.trigger-var code {
  font-size: 9px;
  font-weight: 600;
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 10%, transparent);
  padding: 0 3px;
  border-radius: 2px;
}
</style>
