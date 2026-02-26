<template>
  <div />
</template>

<script setup lang="ts">
// Redirect /docs → /docs/overview (non-blocking for client-side navigation)
if (import.meta.server) {
  await navigateTo("/docs/overview", { replace: true, redirectCode: 301 });
} else {
  navigateTo("/docs/overview", { replace: true });
}
</script>
