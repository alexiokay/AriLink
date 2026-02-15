<template>
  <div class="rounded-lg bg-(--ui-bg-elevated) hover:bg-(--ui-bg-accented) transition-colors">
    <div class="flex items-center gap-3 p-3 cursor-pointer" @click="expanded = !expanded">
      <div class="relative shrink-0">
        <UIcon name="i-lucide-phone-call" class="size-5 text-(--ui-success)" />
        <span class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-(--ui-success) animate-pulse" />
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium text-(--ui-text-highlighted) truncate">
          {{ call.callerName || call.callerId || "Unknown" }}
        </p>
        <div class="flex items-center gap-2 mt-0.5">
          <span v-if="call.callerId" class="text-xs text-(--ui-text-dimmed) font-mono">{{ call.callerId }}</span>
          <span v-if="call.extension" class="text-xs text-(--ui-text-dimmed)">
            &rarr; {{ call.extension }}
          </span>
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <UBadge
          v-if="currentStateInfo"
          :label="currentStateInfo.label"
          :color="currentStateInfo.color"
          variant="subtle"
          size="sm"
          :icon="currentStateInfo.icon"
        />
        <UBadge
          :label="call.assistantName || call.assistant || '—'"
          color="info"
          variant="subtle"
          size="sm"
        />
        <UBadge
          :label="liveDuration"
          color="neutral"
          variant="subtle"
          size="sm"
          class="tabular-nums"
        />
        <UIcon
          v-if="activity.length > 0"
          :name="expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          class="size-4 text-(--ui-text-dimmed)"
        />
      </div>
    </div>

    <!-- Activity timeline -->
    <div v-if="expanded && activity.length > 0" class="px-3 pb-3 pt-0">
      <div class="border-l-2 border-(--ui-border) ml-2 pl-3 space-y-1">
        <div v-for="(entry, i) in activity" :key="i" class="flex items-start gap-2 text-xs">
          <span class="text-(--ui-text-dimmed) tabular-nums shrink-0 mt-px">{{ formatActivityTime(entry.timestamp) }}</span>
          <UIcon :name="activityIcon(entry.type)" class="size-3.5 mt-px shrink-0" :class="activityColor(entry.type)" />
          <span :class="entry.type === 'transcription' ? 'text-(--ui-text) italic' : 'text-(--ui-text-muted)'">
            {{ activityLabel(entry) }}
          </span>
        </div>
      </div>
    </div>

    <!-- Action buttons (opt-in via showActions prop) -->
    <div v-if="showActions" class="flex gap-2 px-3 pb-3" @click.stop>
      <UButton
        label="Hang Up"
        icon="i-lucide-phone-off"
        color="error"
        variant="soft"
        size="sm"
        @click="$emit('hangup', call.id)"
      />
      <UButton
        label="Transfer"
        icon="i-lucide-phone-forwarded"
        color="info"
        variant="soft"
        size="sm"
        @click="$emit('transfer', call.id)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ call: any; showActions?: boolean }>();
defineEmits<{
  hangup: [sessionId: string];
  transfer: [sessionId: string];
}>();

const { assistantStates, callActivity } = useSocket();
const { activityLabel, activityIcon, activityColor, stateInfo: getStateInfo, formatActivityTime } = useActivity();

const expanded = ref(true);

const currentStateInfo = computed(() => {
  const s = assistantStates.value[props.call.id];
  if (!s) return null;
  return getStateInfo(s.state);
});

const activity = computed(() => callActivity.value[props.call.id] || []);

const liveDuration = ref("0:00");
let timer: ReturnType<typeof setInterval> | null = null;

function updateDuration() {
  if (!props.call.startTime) {
    liveDuration.value = "—";
    return;
  }
  const seconds = Math.floor((Date.now() - new Date(props.call.startTime).getTime()) / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  liveDuration.value = `${m}:${s.toString().padStart(2, "0")}`;
}

onMounted(() => {
  updateDuration();
  timer = setInterval(updateDuration, 1000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>
