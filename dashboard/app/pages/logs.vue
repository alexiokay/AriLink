<template>
  <div class="space-y-4 h-full flex flex-col">
    <div class="flex items-center justify-between shrink-0">
      <h1 class="text-2xl font-bold text-(--ui-text-highlighted)">Server Logs</h1>
      <div class="flex items-center gap-2">
        <USwitch v-model="autoScroll" label="Auto-scroll" size="md" />
        <UBadge
          :label="`${logs.length} loaded`"
          color="neutral"
          variant="subtle"
          size="md"
          class="tabular-nums"
        />
        <UButton
          label="Clear"
          icon="i-lucide-trash-2"
          color="neutral"
          variant="ghost"
          size="md"
          @click="logs.length = 0"
        />
      </div>
    </div>

    <!-- Filter bar -->
    <div class="flex items-center gap-2 shrink-0">
      <UInput
        v-model="filterText"
        placeholder="Filter logs..."
        icon="i-lucide-search"
        class="flex-1"
        size="md"
      />
      <USelect
        v-model="filterLevel"
        :items="levelOptions"
        size="md"
      />
    </div>

    <!-- Log container -->
    <div
      ref="logContainer"
      class="flex-1 min-h-0 rounded-lg bg-(--ui-bg) border border-(--ui-border) overflow-y-auto font-mono text-xs"
      @scroll="onScroll"
    >
      <!-- Load more indicator -->
      <div v-if="loadingMore" class="py-2 text-center">
        <UIcon name="i-lucide-loader-2" class="size-4 text-(--ui-text-dimmed) animate-spin" />
      </div>
      <div
        v-else-if="hasMore"
        class="py-2 text-center text-(--ui-text-dimmed) text-xs cursor-pointer hover:text-(--ui-text-muted)"
        @click="loadOlder"
      >
        Scroll up or click to load older logs
      </div>

      <!-- Empty state -->
      <div v-if="filtered.length === 0 && !loadingMore" class="py-12 text-center">
        <UIcon name="i-lucide-terminal" class="size-12 text-(--ui-text-dimmed) mx-auto mb-3" />
        <p class="text-sm text-(--ui-text-muted)">No logs yet</p>
        <p class="text-xs text-(--ui-text-dimmed) mt-1">Server output will appear here in real-time</p>
      </div>

      <!-- Log lines -->
      <div
        v-for="entry in filtered"
        :key="entry.id"
        class="flex gap-2 px-3 py-0.5 hover:bg-(--ui-bg-elevated) transition-colors leading-5"
        :class="entryRowClass(entry.level)"
      >
        <span class="text-(--ui-text-dimmed) shrink-0 tabular-nums whitespace-nowrap">
          {{ formatTime(entry.timestamp) }}
        </span>
        <span
          class="shrink-0 w-10 text-center"
          :class="levelClass(entry.level)"
        >
          {{ levelLabel(entry.level) }}
        </span>
        <span class="flex-1 whitespace-pre-wrap break-all" :class="messageClass(entry.level)">{{ entry.message }}</span>
      </div>

      <!-- Scroll anchor for auto-scroll -->
      <div ref="scrollAnchor" />
    </div>
  </div>
</template>

<script setup lang="ts">
const { logs, logsTotal, emit } = useSocket();

const logContainer = ref<HTMLElement | null>(null);
const scrollAnchor = ref<HTMLElement | null>(null);
const autoScroll = ref(true);
const loadingMore = ref(false);
const filterText = ref("");
const filterLevel = ref("all");

const levelOptions = [
  { label: "All levels", value: "all" },
  { label: "Logs", value: "log" },
  { label: "Warnings", value: "warn" },
  { label: "Errors", value: "error" },
];

const filtered = computed(() => {
  let entries = logs.value;

  if (filterLevel.value !== "all") {
    entries = entries.filter((e: any) => e.level === filterLevel.value);
  }

  if (filterText.value) {
    const q = filterText.value.toLowerCase();
    entries = entries.filter((e: any) => e.message.toLowerCase().includes(q));
  }

  // Display in chronological order (oldest first, newest at bottom)
  return [...entries].reverse();
});

const hasMore = computed(() => {
  return logs.value.length < logsTotal.value;
});

function loadOlder() {
  if (loadingMore.value) return;

  // Find the oldest entry id in our current buffer
  const oldest = logs.value.length > 0
    ? Math.min(...logs.value.map((e: any) => e.id))
    : undefined;

  loadingMore.value = true;
  emit("dashboard:getLogs", { limit: 200, before: oldest });

  // Reset loading after a short timeout (the response comes via socket)
  setTimeout(() => {
    loadingMore.value = false;
  }, 1000);
}

function onScroll() {
  const el = logContainer.value;
  if (!el) return;

  // If scrolled near the top, load more
  if (el.scrollTop < 100 && hasMore.value && !loadingMore.value) {
    loadOlder();
  }

  // Track if user is near bottom for auto-scroll
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  autoScroll.value = nearBottom;
}

// Auto-scroll to bottom when new entries arrive
const initialScrollDone = ref(false);
watch(
  () => logs.value.length,
  () => {
    if (!autoScroll.value) return;
    nextTick(() => {
      if (!initialScrollDone.value) {
        // First load: jump instantly to bottom (no smooth animation)
        const el = logContainer.value;
        if (el) el.scrollTop = el.scrollHeight;
        initialScrollDone.value = true;
      } else {
        scrollAnchor.value?.scrollIntoView({ behavior: "smooth" });
      }
    });
  }
);

function formatTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
    + "." + String(d.getMilliseconds()).padStart(3, "0");
}

function levelLabel(level: string): string {
  if (level === "warn") return "WARN";
  if (level === "error") return "ERR";
  return "LOG";
}

function levelClass(level: string): string {
  if (level === "error") return "text-(--ui-error) font-semibold";
  if (level === "warn") return "text-(--ui-warning) font-semibold";
  return "text-(--ui-text-dimmed)";
}

function messageClass(level: string): string {
  if (level === "error") return "text-(--ui-error)";
  if (level === "warn") return "text-(--ui-warning)";
  return "text-(--ui-text)";
}

function entryRowClass(level: string): string {
  if (level === "error") return "bg-red-500/5";
  if (level === "warn") return "bg-yellow-500/5";
  return "";
}

// Load initial batch of logs on mount
onMounted(() => {
  emit("dashboard:getLogs", { limit: 200 });
});
</script>
