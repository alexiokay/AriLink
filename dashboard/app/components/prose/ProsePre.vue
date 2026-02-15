<template>
  <div v-if="language === 'mermaid' && code" class="my-4 rounded-lg border border-(--ui-border)">
    <ChatMermaidBlock :code="code" />
  </div>
  <pre v-else class="docs-pre"><slot /></pre>
</template>

<script setup lang="ts">
defineProps<{
  code?: string;
  language?: string;
  filename?: string;
  highlights?: number[];
  meta?: string;
}>();
</script>

<style>
.docs-pre {
  background: var(--ui-bg-elevated);
  border: 1px solid var(--ui-border);
  border-radius: 0.5rem;
  padding: 0.875rem 1rem;
  overflow-x: auto;
  margin: 0.75rem 0;
}
.docs-pre code {
  background: none !important;
  padding: 0 !important;
  border: none !important;
  font-size: 0.8125rem;
  line-height: 1.6;
  font-family: ui-monospace, monospace;
}
</style>
