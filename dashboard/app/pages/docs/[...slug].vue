<template>
  <div class="docs-content">
    <ContentRenderer v-if="page" :value="page" />
    <div v-else class="text-center py-12 text-(--ui-text-dimmed)">
      <UIcon name="i-lucide-file-x" class="size-8 mx-auto mb-2" />
      <p>Page not found</p>
    </div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute();
const slug = computed(() => {
  const parts = route.params.slug;
  return Array.isArray(parts) ? parts.join("/") : parts || "overview";
});

const { data: page } = await useAsyncData(
  () => `docs-${slug.value}`,
  () => queryCollection("docs").path(`/docs/${slug.value}`).first(),
  { watch: [slug] },
);
</script>

<style>
/* ── Base typography ── */
.docs-content {
  max-width: 52rem;
}

.docs-content h1 {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--ui-text-highlighted);
  margin-bottom: 0.5rem;
  padding-bottom: 0.75rem;
  border-bottom: 2px solid var(--ui-border);
}

.docs-content h2 {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--ui-text-highlighted);
  margin-top: 2rem;
  margin-bottom: 0.5rem;
  padding-bottom: 0.375rem;
  border-bottom: 1px solid color-mix(in srgb, var(--ui-border) 50%, transparent);
}

.docs-content h3 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--ui-text-highlighted);
  margin-top: 1.5rem;
  margin-bottom: 0.375rem;
}

/* Heading anchor links should NOT look like links */
.docs-content h1 a,
.docs-content h2 a,
.docs-content h3 a,
.docs-content h4 a {
  color: inherit;
  text-decoration: none;
}
.docs-content h1 a:hover,
.docs-content h2 a:hover,
.docs-content h3 a:hover,
.docs-content h4 a:hover {
  opacity: 0.7;
}

/* ── Body text ── */
.docs-content p {
  font-size: 0.875rem;
  color: var(--ui-text-muted);
  line-height: 1.7;
  margin-bottom: 0.75rem;
}

/* Inline links (not heading anchors) */
.docs-content p a,
.docs-content li a,
.docs-content td a {
  color: var(--ui-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.docs-content p a:hover,
.docs-content li a:hover,
.docs-content td a:hover {
  opacity: 0.8;
}

.docs-content strong {
  font-weight: 600;
  color: var(--ui-text-highlighted);
}

/* ── Inline code ── */
.docs-content code {
  font-size: 0.8125rem;
  background: var(--ui-bg-elevated);
  padding: 0.15rem 0.4rem;
  border-radius: 0.25rem;
  font-family: ui-monospace, monospace;
  border: 1px solid color-mix(in srgb, var(--ui-border) 60%, transparent);
}

/* Code inside pre blocks (handled by Pre.vue) */
.docs-content pre code {
  background: none !important;
  padding: 0 !important;
  border: none !important;
  font-size: 0.8125rem;
  line-height: 1.6;
}

/* ── Lists ── */
.docs-content ul {
  list-style: disc;
  margin-left: 1.25rem;
  margin-bottom: 0.75rem;
}
.docs-content ol {
  list-style: decimal;
  margin-left: 1.25rem;
  margin-bottom: 0.75rem;
}
.docs-content li {
  font-size: 0.875rem;
  color: var(--ui-text-muted);
  line-height: 1.7;
  margin-bottom: 0.35rem;
}
.docs-content li strong {
  color: var(--ui-text-highlighted);
}

/* ── Tables ── */
.docs-content table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
  margin: 1rem 0;
  border: 1px solid var(--ui-border);
  border-radius: 0.5rem;
  overflow: hidden;
}
.docs-content thead {
  background: color-mix(in srgb, var(--ui-bg-elevated) 80%, transparent);
}
.docs-content thead tr {
  border-bottom: 2px solid var(--ui-border);
}
.docs-content th {
  text-align: left;
  padding: 0.625rem 0.75rem;
  font-weight: 600;
  color: var(--ui-text-highlighted);
  font-size: 0.8125rem;
  white-space: nowrap;
}
.docs-content td {
  padding: 0.5rem 0.75rem;
  color: var(--ui-text-muted);
  border-bottom: 1px solid color-mix(in srgb, var(--ui-border) 50%, transparent);
  line-height: 1.5;
}
.docs-content tbody tr:last-child td {
  border-bottom: none;
}
.docs-content tbody tr:hover {
  background: color-mix(in srgb, var(--ui-bg-elevated) 40%, transparent);
}

/* ── Blockquote ── */
.docs-content blockquote {
  border-left: 3px solid var(--ui-primary);
  padding-left: 1rem;
  margin: 1rem 0;
  color: var(--ui-text-dimmed);
  font-style: italic;
}

/* ── Horizontal rule ── */
.docs-content hr {
  border: none;
  border-top: 1px solid var(--ui-border);
  margin: 2rem 0;
}
</style>
