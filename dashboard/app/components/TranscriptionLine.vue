<template>
  <div class="flex items-center gap-2 py-0.5 px-2 rounded-md hover:bg-(--ui-bg-elevated) transition-colors">
    <span class="text-(--ui-text-dimmed) text-xs shrink-0 tabular-nums whitespace-nowrap">
      {{ formatTime(data.timestamp) }}
    </span>
    <span
      class="text-sm flex-1"
      :class="data.is_final ? 'text-(--ui-text)' : 'text-(--ui-text-dimmed) italic'"
    >
      {{ data.text }}
    </span>
    <UBadge
      v-if="data.is_final"
      label="final"
      color="success"
      variant="subtle"
      size="xs"
      class="shrink-0"
    />
  </div>
</template>

<script setup lang="ts">
defineProps<{ data: any }>();

function formatTime(ts: string | number) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString();
}
</script>
