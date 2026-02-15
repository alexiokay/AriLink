<template>
  <div class="space-y-8">
    <!-- Active Calls -->
    <section class="space-y-4">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold text-(--ui-text-highlighted)">Active Calls</h1>
        <UBadge
          :label="`${activeCalls.length} active`"
          :color="activeCalls.length > 0 ? 'success' : 'neutral'"
          variant="subtle"
          icon="i-lucide-phone"
        />
      </div>

      <UCard v-if="activeCalls.length === 0">
        <div class="py-8 text-center">
          <UIcon name="i-lucide-phone-off" class="size-10 text-(--ui-text-dimmed) mx-auto mb-2" />
          <p class="text-(--ui-text-muted)">No active calls right now</p>
        </div>
      </UCard>

      <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CallCard
          v-for="call in activeCalls"
          :key="call.id"
          :call="call"
          show-actions
          @hangup="hangup"
          @transfer="openTransfer"
        />
      </div>
    </section>

    <!-- Call History -->
    <section class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-bold text-(--ui-text-highlighted)">Call History</h2>
        <UBadge
          :label="`${historyTotal} total`"
          color="neutral"
          variant="subtle"
          icon="i-lucide-archive"
        />
      </div>

      <!-- Search -->
      <div class="flex gap-3">
        <UInput
          v-model="historySearch"
          placeholder="Search by caller, name, or assistant..."
          icon="i-lucide-search"
          class="flex-1"
          @keyup.enter="fetchHistory()"
        />
        <UButton label="Search" icon="i-lucide-search" color="primary" variant="soft" size="md" @click="fetchHistory()" />
      </div>

      <!-- Loading -->
      <div v-if="historyLoading" class="py-8 text-center">
        <UIcon name="i-lucide-loader-2" class="size-6 text-(--ui-text-dimmed) mx-auto mb-2 animate-spin" />
        <p class="text-sm text-(--ui-text-muted)">Loading...</p>
      </div>

      <!-- Empty state -->
      <UCard v-else-if="historyCalls.length === 0">
        <div class="py-8 text-center">
          <UIcon name="i-lucide-archive" class="size-10 text-(--ui-text-dimmed) mx-auto mb-2" />
          <p class="text-(--ui-text-muted)">No call history yet</p>
        </div>
      </UCard>

      <!-- History list -->
      <div v-else class="space-y-3">
        <UCard
          v-for="call in historyCalls"
          :key="call.id"
          class="cursor-pointer"
          @click="toggleExpand(call.id)"
        >
          <div class="flex items-center gap-4">
            <UIcon
              :name="call.status === 'active' ? 'i-lucide-phone-call' : 'i-lucide-phone-off'"
              :class="call.status === 'active' ? 'text-(--ui-success)' : 'text-(--ui-text-dimmed)'"
              class="size-5 shrink-0"
            />

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium text-(--ui-text-highlighted) truncate">
                  {{ call.caller_name || call.caller_id || "Unknown" }}
                </span>
                <span v-if="call.caller_id" class="text-sm text-(--ui-text-dimmed) font-mono">
                  {{ call.caller_id }}
                </span>
              </div>
              <div class="flex items-center gap-3 mt-0.5 text-sm text-(--ui-text-dimmed)">
                <span>{{ formatDate(call.start_time) }}</span>
                <span v-if="call.duration_sec != null">{{ formatDuration(call.duration_sec) }}</span>
                <span v-if="call.extension">ext {{ call.extension }}</span>
              </div>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <UBadge
                v-if="call.assistant_name || call.assistant"
                :label="call.assistant_name || call.assistant"
                color="info"
                variant="subtle"
                size="md"
              />
              <UBadge
                :label="call.status"
                :color="call.status === 'active' ? 'success' : 'neutral'"
                variant="subtle"
                size="md"
              />
              <UIcon
                :name="expanded === call.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                class="size-4 text-(--ui-text-dimmed)"
              />
            </div>
          </div>

          <!-- Expanded activity timeline -->
          <div v-if="expanded === call.id" class="mt-4 pt-4 border-t border-(--ui-border)">
            <div v-if="expandedLoading" class="py-4 text-center">
              <UIcon name="i-lucide-loader-2" class="size-4 text-(--ui-text-dimmed) animate-spin" />
            </div>
            <div v-else-if="expandedEvents.length === 0" class="py-4 text-center">
              <p class="text-sm text-(--ui-text-dimmed) italic">No activity recorded</p>
            </div>
            <div v-else class="border-l-2 border-(--ui-border) ml-2 pl-3 space-y-1 max-h-64 overflow-y-auto">
              <div v-for="(entry, i) in expandedEvents" :key="i" class="flex items-start gap-2 text-xs">
                <span class="text-(--ui-text-dimmed) tabular-nums shrink-0 mt-px">{{ formatActivityTime(entry.timestamp) }}</span>
                <UIcon :name="activityIcon(entry.type)" class="size-3.5 mt-px shrink-0" :class="activityColor(entry.type)" />
                <span :class="entry.type === 'transcription' ? 'text-(--ui-text) italic' : 'text-(--ui-text-muted)'">
                  {{ activityLabel(entry) }}
                </span>
              </div>
            </div>
          </div>
        </UCard>

        <!-- Pagination -->
        <div v-if="historyTotal > pageSize" class="flex items-center justify-center gap-2 pt-2">
          <UButton
            label="Previous"
            icon="i-lucide-chevron-left"
            color="neutral"
            variant="ghost"
            size="md"
            :disabled="page === 0"
            @click="page--; fetchHistory()"
          />
          <span class="text-sm text-(--ui-text-dimmed) tabular-nums">
            {{ page * pageSize + 1 }}&ndash;{{ Math.min((page + 1) * pageSize, historyTotal) }} of {{ historyTotal }}
          </span>
          <UButton
            label="Next"
            icon="i-lucide-chevron-right"
            trailing
            color="neutral"
            variant="ghost"
            size="md"
            :disabled="(page + 1) * pageSize >= historyTotal"
            @click="page++; fetchHistory()"
          />
        </div>
      </div>
    </section>

    <!-- Transfer Modal -->
    <TransferModal v-model:open="transferOpen" @select="doTransfer" />
  </div>
</template>

<script setup lang="ts">
const { activeCalls, emit } = useSocket();
const { activityLabel, activityIcon, activityColor, formatActivityTime } = useActivity();

// ── Active call actions ──

const transferOpen = ref(false);
const transferSessionId = ref<string | null>(null);

function hangup(sessionId: string) {
  emit("dashboard:hangup", { sessionId });
}

function openTransfer(sessionId: string) {
  transferSessionId.value = sessionId;
  transferOpen.value = true;
}

function doTransfer(endpoint: string) {
  if (transferSessionId.value) {
    emit("dashboard:transfer", { sessionId: transferSessionId.value, endpoint });
  }
  transferSessionId.value = null;
}

// ── Call history ──

const historyCalls = ref<any[]>([]);
const historyTotal = ref(0);
const historyLoading = ref(false);
const historySearch = ref("");
const page = ref(0);
const pageSize = 20;
const expanded = ref<string | null>(null);
const expandedEvents = ref<{ type: string; text: string; timestamp: string }[]>([]);
const expandedLoading = ref(false);

async function fetchHistory() {
  historyLoading.value = true;
  try {
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String(page.value * pageSize),
    });
    if (historySearch.value) params.set("search", historySearch.value);

    const res = await fetch(`/api/history?${params}`);
    const data = await res.json();
    historyCalls.value = data.calls || [];
    historyTotal.value = data.total || 0;
  } catch (e) {
    console.error("Failed to fetch history:", e);
  } finally {
    historyLoading.value = false;
  }
}

async function toggleExpand(callId: string) {
  if (expanded.value === callId) {
    expanded.value = null;
    return;
  }

  expanded.value = callId;
  expandedEvents.value = [];
  expandedLoading.value = true;

  try {
    const res = await fetch(`/api/history/${callId}`);
    const data = await res.json();
    expandedEvents.value = data.events || [];
  } catch (e) {
    console.error("Failed to fetch call events:", e);
  } finally {
    expandedLoading.value = false;
  }
}

// ── Formatters ──

function formatDate(ts: string) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString();
}

function formatDuration(sec: number) {
  if (sec == null) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

onMounted(() => fetchHistory());
</script>
