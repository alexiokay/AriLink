<template>
  <div class="my-4 flex gap-3 p-4 rounded-lg border text-sm leading-relaxed" :class="boxClass">
    <UIcon :name="iconName" class="size-5 shrink-0 mt-0.5" />
    <div class="min-w-0">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ type?: string }>();

const iconName = computed(() => {
  const icons: Record<string, string> = {
    tip: "i-lucide-lightbulb",
    warning: "i-lucide-alert-triangle",
    info: "i-lucide-info",
    danger: "i-lucide-shield-alert",
  };
  return icons[props.type || "tip"] || icons.tip;
});

const boxClass = computed(() => {
  const classes: Record<string, string> = {
    tip: "bg-primary/5 border-primary/20 text-(--ui-text-muted)",
    warning: "bg-amber-500/5 border-amber-500/20 text-(--ui-text-muted)",
    info: "bg-blue-500/5 border-blue-500/20 text-(--ui-text-muted)",
    danger: "bg-red-500/5 border-red-500/20 text-(--ui-text-muted)",
  };
  return classes[props.type || "tip"] || classes.tip;
});
</script>
