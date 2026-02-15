<template>
  <div
    class="relative overflow-hidden"
    @mouseenter="paused = true"
    @mouseleave="paused = false"
  >
    <!-- Slides -->
    <Transition :name="'slide-' + direction" mode="out-in">
      <!-- Slide 0: Pro status -->
      <div
        v-if="current === 0 && proActive"
        key="pro-active"
        class="block rounded-lg border border-green-500/20 bg-green-500/5 p-3"
        :class="collapsed ? 'flex items-center justify-center p-2' : ''"
      >
        <template v-if="collapsed">
          <UIcon name="i-lucide-shield-check" class="size-5 text-green-500" />
        </template>
        <template v-else>
          <div class="flex items-center gap-2 mb-1.5">
            <UIcon name="i-lucide-shield-check" class="size-4 text-green-500 shrink-0" />
            <span class="text-sm font-semibold text-(--ui-text-highlighted)">Pro Active</span>
          </div>
          <p class="text-xs text-(--ui-text-muted) leading-relaxed">
            All Pro features unlocked
          </p>
        </template>
      </div>

      <!-- Slide 0: Get Pro (not active) -->
      <a
        v-else-if="current === 0"
        key="pro"
        :href="SPONSOR_URL"
        target="_blank"
        class="block rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 transition-colors hover:bg-amber-500/10"
        :class="collapsed ? 'flex items-center justify-center p-2' : ''"
      >
        <template v-if="collapsed">
          <UIcon name="i-lucide-sparkles" class="size-5 text-amber-500" />
        </template>
        <template v-else>
          <div class="flex items-center gap-2 mb-1.5">
            <UIcon name="i-lucide-sparkles" class="size-4 text-amber-500 shrink-0" />
            <span class="text-sm font-semibold text-(--ui-text-highlighted)">Get Pro</span>
          </div>
          <p class="text-xs text-(--ui-text-muted) leading-relaxed">
            Docker deploy, auto-config &amp; pro support
          </p>
        </template>
      </a>

      <!-- Slide 1: VortiDeck -->
      <a
        v-else-if="current === 1"
        key="vortideck"
        :href="VORTIDECK_URL"
        target="_blank"
        class="block rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 transition-colors hover:bg-blue-500/10"
        :class="collapsed ? 'flex items-center justify-center p-2' : ''"
      >
        <template v-if="collapsed">
          <UIcon name="i-lucide-globe" class="size-5 text-blue-500" />
        </template>
        <template v-else>
          <div class="flex items-center gap-2 mb-1.5">
            <UIcon name="i-lucide-globe" class="size-4 text-blue-500 shrink-0" />
            <span class="text-sm font-semibold text-(--ui-text-highlighted)">VortiDeck.com</span>
          </div>
          <p class="text-xs text-(--ui-text-muted) leading-relaxed">
            Check out VortiDeck
          </p>
        </template>
      </a>
    </Transition>

    <!-- Dots -->
    <div v-if="!collapsed" class="flex justify-center gap-2 mt-2">
      <button
        v-for="i in slideCount"
        :key="i"
        class="size-2 rounded-full transition-colors"
        :class="current === i - 1 ? 'bg-(--ui-primary)' : 'bg-(--ui-text-dimmed)/25'"
        @click="goTo(i - 1)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ collapsed: boolean }>();

const { proActive, check: checkPro } = useProStatus();
onMounted(() => checkPro());

const slideCount = 2;
const current = ref(0);
const paused = ref(false);
const direction = ref<"left" | "right">("left");

let timer: ReturnType<typeof setInterval> | null = null;

function goTo(index: number) {
  direction.value = index > current.value ? "left" : "right";
  current.value = index;
}

function startTimer() {
  timer = setInterval(() => {
    if (!paused.value) {
      direction.value = "left";
      current.value = (current.value + 1) % slideCount;
    }
  }, 6000);
}

onMounted(startTimer);

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<style scoped>
.slide-left-enter-active,
.slide-left-leave-active,
.slide-right-enter-active,
.slide-right-leave-active {
  transition: all 0.25s ease;
}

.slide-left-enter-from {
  opacity: 0;
  transform: translateX(12px);
}
.slide-left-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}

.slide-right-enter-from {
  opacity: 0;
  transform: translateX(-12px);
}
.slide-right-leave-to {
  opacity: 0;
  transform: translateX(12px);
}
</style>
