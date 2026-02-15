<template>
  <UBadge
    :label="liveDuration"
    color="neutral"
    variant="subtle"
    size="xs"
    icon="i-lucide-clock"
    class="tabular-nums"
  />
</template>

<script setup lang="ts">
const props = defineProps<{ startTime: string | number }>();

const liveDuration = ref("0:00");
let timer: ReturnType<typeof setInterval> | null = null;

function update() {
  if (!props.startTime) {
    liveDuration.value = "—";
    return;
  }
  const seconds = Math.floor((Date.now() - new Date(props.startTime).getTime()) / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  liveDuration.value = `${m}:${s.toString().padStart(2, "0")}`;
}

onMounted(() => {
  update();
  timer = setInterval(update, 1000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>
