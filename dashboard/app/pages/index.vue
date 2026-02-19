<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-(--ui-text-highlighted)">Dashboard</h1>
      <UBadge
        :label="`${activeCalls.length} active call${activeCalls.length !== 1 ? 's' : ''}`"
        :color="activeCalls.length > 0 ? 'success' : 'neutral'"
        variant="subtle"
        icon="i-lucide-phone"
      />
    </div>

    <!-- Service Status Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <UCard v-for="(svc, key) in services" :key="key">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <UIcon :name="serviceIcon(key as string)" class="size-5" :class="svc.status === 'error' || svc.status === 'disconnected' ? 'text-(--ui-error)' : 'text-(--ui-text-dimmed)'" />
            <span class="font-medium text-(--ui-text-muted)">{{ svc.label }}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <UButton
              v-if="serviceAction(key as string)"
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              size="xs"
              :loading="svc.status === 'connecting'"
              :title="`Reconnect ${svc.label}`"
              @click="reconnectService(key as string)"
            />
            <UBadge
              :label="svc.status"
              :color="statusColor(svc.status)"
              variant="subtle"
              size="md"
            />
          </div>
        </div>

        <!-- Connected: show address -->
        <p v-if="svc.detail && !isErrorStatus(svc.status)" class="mt-2 text-sm text-(--ui-text-dimmed) font-mono truncate">
          {{ svc.detail }}
        </p>

        <!-- Error: show parsed message + hint -->
        <div v-if="svc.detail && isErrorStatus(svc.status)" class="mt-3 px-3 py-2.5 rounded-md bg-(--ui-error)/5 border border-(--ui-error)/15">
          <p class="text-sm font-medium text-(--ui-error)">{{ parseError(svc.detail).message }}</p>
          <p class="text-xs text-(--ui-text-muted) mt-1">{{ parseError(svc.detail).hint }}</p>
        </div>
      </UCard>
    </div>

    <!-- Active Calls -->
    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-phone-call" class="size-5 text-(--ui-primary)" />
            <span class="font-semibold text-(--ui-text-highlighted)">Active Calls</span>
          </div>
          <UBadge :label="String(activeCalls.length)" color="neutral" variant="subtle" size="md" />
        </div>
      </template>

      <div v-if="activeCalls.length === 0" class="py-8 text-center">
        <UIcon name="i-lucide-phone-off" class="size-10 text-(--ui-text-dimmed) mx-auto mb-2" />
        <p class="text-(--ui-text-muted)">No active calls</p>
      </div>
      <div v-else class="space-y-2">
        <CallCard v-for="call in activeCalls" :key="call.id" :call="call" />
      </div>
    </UCard>

  </div>
</template>

<script setup lang="ts">
const { activeCalls, services, emit } = useSocket();

function statusColor(status: string): "success" | "error" | "neutral" | "warning" {
  if (status === "ok" || status === "connected") return "success";
  if (status === "error" || status === "disconnected") return "error";
  if (status === "connecting") return "warning";
  if (status === "disabled") return "neutral";
  return "neutral";
}

function serviceIcon(key: string): string {
  const icons: Record<string, string> = {
    asterisk: "i-lucide-server",
    rustRtp: "i-lucide-radio",
    transcription: "i-lucide-mic",
    tts: "i-lucide-volume-2",
  };
  return icons[key] || "i-lucide-circle";
}

function serviceAction(key: string): boolean {
  return key === "asterisk" || key === "transcription" || key === "rustRtp";
}

function reconnectService(key: string) {
  if (key === "asterisk") {
    emit("dashboard:reconnectAri");
  } else if (key === "transcription" || key === "rustRtp") {
    emit("dashboard:reconnectTranscription");
  }
}

function isErrorStatus(status: string): boolean {
  return status === "error" || status === "disconnected";
}

function parseError(detail: string): { message: string; hint: string } {
  const d = detail.toLowerCase();

  if (d.includes("etimedout")) {
    const host = detail.match(/\d+\.\d+\.\d+\.\d+[:\d]*/)?.[0] || "";
    return {
      message: `Connection timed out${host ? ` (${host})` : ""}`,
      hint: "Host unreachable — check IP address, firewall rules, and that the service is running.",
    };
  }
  if (d.includes("econnrefused")) {
    const host = detail.match(/\d+\.\d+\.\d+\.\d+[:\d]*/)?.[0] || detail.match(/localhost[:\d]*/)?.[0] || "";
    return {
      message: `Connection refused${host ? ` (${host})` : ""}`,
      hint: "Port is closed — the service may not be running or is on a different port.",
    };
  }
  if (d.includes("econnreset")) {
    return {
      message: "Connection reset",
      hint: "The service dropped the connection — it may have crashed or restarted.",
    };
  }
  if (d.includes("enotfound")) {
    const host = detail.match(/getaddrinfo.*?(\S+)$/)?.[1] || "";
    return {
      message: `Host not found${host ? ` (${host})` : ""}`,
      hint: "DNS lookup failed — check the hostname in your .env configuration.",
    };
  }
  if (d.includes("401") || d.includes("unauthorized")) {
    return {
      message: "Authentication failed",
      hint: "Wrong credentials — check username and password in .env.",
    };
  }
  if (d.includes("403") || d.includes("forbidden")) {
    return {
      message: "Access forbidden",
      hint: "The service rejected the connection — check permissions and allowed origins.",
    };
  }
  if (d.includes("server offline")) {
    return {
      message: "Server offline",
      hint: "The dashboard server itself is unreachable — it may be restarting.",
    };
  }

  return {
    message: detail.length > 80 ? detail.slice(0, 80) + "..." : detail,
    hint: "Check the server logs for more details.",
  };
}
</script>
