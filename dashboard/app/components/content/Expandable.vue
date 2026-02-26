<template>
  <details class="expandable" :open="open || undefined">
    <summary class="expandable-trigger">
      <UIcon v-if="icon" :name="icon" class="size-4 shrink-0" />
      <span class="expandable-title">{{ title }}</span>
      <UIcon name="i-lucide-chevron-right" class="expandable-chevron size-4 shrink-0 ml-auto" />
    </summary>
    <div class="expandable-body">
      <slot />
    </div>
  </details>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
  icon?: string;
  open?: boolean;
}>();
</script>

<style>
.expandable {
  border: 1px solid var(--ui-border);
  border-radius: 0.5rem;
  margin: 0.5rem 0;
  overflow: hidden;
}

.expandable-trigger {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 0.75rem;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--ui-text-highlighted);
  background: color-mix(in srgb, var(--ui-bg-elevated) 50%, transparent);
  user-select: none;
  list-style: none;
  transition: background 0.15s;
}

.expandable-trigger:hover {
  background: var(--ui-bg-elevated);
}

.expandable-trigger::-webkit-details-marker {
  display: none;
}

.expandable-chevron {
  color: var(--ui-text-dimmed);
  transition: transform 0.2s ease;
}

.expandable[open] > .expandable-trigger .expandable-chevron {
  transform: rotate(90deg);
}

.expandable-body {
  padding: 0.5rem 0.75rem 0.75rem;
  border-top: 1px solid color-mix(in srgb, var(--ui-border) 50%, transparent);
}

/* Tighten spacing for code blocks inside expandable */
.expandable-body .docs-pre {
  margin: 0.25rem 0 0;
}

.expandable-body p:last-child {
  margin-bottom: 0;
}
</style>
