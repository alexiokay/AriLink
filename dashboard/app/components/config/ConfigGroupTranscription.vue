<template>
  <div class="space-y-4">
    <!-- Provider selector -->
    <UFormField label="Provider">
      <template #hint>
        <span class="text-[10px] font-mono text-muted-foreground opacity-50 bg-(--ui-bg-elevated) px-1.5 py-0.5 rounded">TRANSCRIPTION_PROVIDER</span>
      </template>
      <USelect
        v-model="envValues['TRANSCRIPTION_PROVIDER']"
        :items="providerOptions"
        class="font-mono text-sm"
      />
    </UFormField>

    <!-- Status indicator (local providers only) -->
    <div v-if="isLocalWs && status === 'checking'" class="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--ui-bg-elevated)/40 border border-(--ui-border)">
      <UIcon name="i-lucide-loader-2" class="size-4 text-(--ui-text-dimmed) animate-spin" />
      <span class="text-xs text-(--ui-text-dimmed)">Checking service...</span>
    </div>
    <div v-else-if="isLocalWs && status === 'mismatch'" class="flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
      <UIcon name="i-lucide-alert-triangle" class="size-4 text-amber-500 shrink-0 mt-0.5" />
      <div>
        <p class="text-sm text-(--ui-text-muted)">{{ statusMessage }}</p>
        <p class="text-xs text-(--ui-text-dimmed) mt-1">
          The service at this URL is <strong>{{ statusActualService }}</strong>, not {{ providerLabel }}.
          Switch provider to match or point to a different URL.
        </p>
      </div>
    </div>
    <div v-else-if="isLocalWs && status === 'available'" class="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/5 border border-green-500/20">
      <UIcon name="i-lucide-check-circle" class="size-4 text-green-500" />
      <span class="text-sm text-(--ui-text-muted)">{{ statusMessage }}</span>
    </div>
    <div v-else-if="isLocalWs && status === 'unavailable'" class="flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
      <UIcon name="i-lucide-alert-triangle" class="size-4 text-amber-500 shrink-0 mt-0.5" />
      <div>
        <p class="text-sm text-(--ui-text-muted)">{{ statusMessage }}</p>
        <p v-if="statusHint" class="text-xs font-mono text-(--ui-text-dimmed) mt-1 px-2 py-1 rounded bg-(--ui-bg-elevated)">{{ statusHint }}</p>
      </div>
    </div>

    <!-- Standard env var fields (excluding Google credentials — handled below) -->
    <UFormField
      v-for="v in standardVars"
      :key="v.key"
      :label="v.label"
      class="group"
    >
      <template #hint>
        <span class="text-[10px] font-mono text-muted-foreground opacity-50 bg-(--ui-bg-elevated) px-1.5 py-0.5 rounded">{{ v.key }}</span>
      </template>
      <div class="flex items-center gap-2 bg-(--ui-bg-elevated)/40 p-1 rounded-lg border border-(--ui-border) focus-within:border-primary/50 transition-all">
        <UInput
          v-model="envValues[v.key]"
          :type="v.sensitive && !revealed[v.key] ? 'password' : 'text'"
          variant="none"
          class="font-mono flex-1 text-sm pl-2"
        />
        <UButton
          v-if="v.sensitive"
          :icon="revealed[v.key] ? 'i-lucide-eye-off' : 'i-lucide-eye'"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="revealed[v.key] = !revealed[v.key]"
          class="mr-1"
        />
      </div>
    </UFormField>

    <!-- Google credentials (paste JSON) -->
    <div v-if="isGoogle" class="space-y-3">
      <UFormField label="Service Account JSON">
        <template #hint>
          <span class="text-[10px] font-mono text-muted-foreground opacity-50 bg-(--ui-bg-elevated) px-1.5 py-0.5 rounded">GOOGLE_CREDENTIALS_JSON</span>
        </template>
        <div class="space-y-2">
          <!-- Status: credentials configured -->
          <div v-if="googleSummary" class="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/5 border border-green-500/20">
            <UIcon name="i-lucide-check-circle" class="size-4 text-green-500 shrink-0" />
            <div class="text-xs text-(--ui-text-muted)">
              <span class="font-medium">{{ googleSummary.projectId }}</span>
              <span class="text-(--ui-text-dimmed) ml-1">({{ googleSummary.clientEmail }})</span>
            </div>
            <UButton
              icon="i-lucide-x"
              color="error"
              variant="ghost"
              size="xs"
              class="ml-auto"
              title="Remove credentials"
              @click="clearGoogleCredentials"
            />
          </div>
          <!-- Paste area -->
          <div
            class="relative rounded-lg border border-dashed border-(--ui-border) hover:border-primary/50 transition-all bg-(--ui-bg-elevated)/30 p-3 cursor-pointer"
            @click="($refs.googleFileInput as HTMLInputElement)?.click()"
          >
            <textarea
              v-model="googleJsonInput"
              placeholder='Paste your Google service account JSON here...'
              rows="4"
              class="w-full bg-transparent font-mono text-xs text-(--ui-text-muted) resize-none outline-none placeholder:text-(--ui-text-dimmed)"
              @click.stop
            />
            <div class="flex items-center gap-2 mt-2">
              <UButton
                label="Apply"
                icon="i-lucide-check"
                color="primary"
                variant="soft"
                size="xs"
                :disabled="!googleJsonInput.trim()"
                @click.stop="applyGoogleCredentials"
              />
              <span class="text-[10px] text-(--ui-text-dimmed)">or upload a .json file</span>
              <input
                ref="googleFileInput"
                type="file"
                accept=".json"
                class="hidden"
                @change="handleGoogleFile"
                @click.stop
              />
            </div>
          </div>
        </div>
      </UFormField>
    </div>

    <!-- Device selector (local providers only) -->
    <UFormField v-if="isLocalWs" label="Inference Device">
      <template #hint>
        <span class="text-[10px] font-mono text-muted-foreground opacity-50 bg-(--ui-bg-elevated) px-1.5 py-0.5 rounded">TRANSCRIPTION_DEVICE</span>
      </template>
      <USelect
        v-model="envValues['TRANSCRIPTION_DEVICE']"
        :items="deviceOptions"
        class="font-mono text-sm"
      />
    </UFormField>

    <!-- Test button -->
    <div class="pt-3 mt-1 border-t border-(--ui-border) space-y-2">
      <div class="flex items-center gap-3">
        <UButton
          label="Test Transcription"
          icon="i-lucide-mic"
          color="primary"
          variant="soft"
          size="sm"
          :loading="testing"
          @click="test"
        />
        <UBadge v-if="result" :color="resultColor" variant="subtle">
          <UIcon :name="resultIcon" class="size-3 mr-1" />
          {{ resultLabel }}
        </UBadge>
      </div>
      <!-- Mismatch warning from test -->
      <div v-if="result?.success && result.mismatch" class="flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
        <UIcon name="i-lucide-alert-triangle" class="size-4 text-amber-500 shrink-0 mt-0.5" />
        <p class="text-xs text-(--ui-text-muted)">{{ result.mismatchMessage }}</p>
      </div>
      <!-- Success info from test -->
      <div v-if="result?.success && !result.mismatch && result.model" class="flex items-start gap-2 p-3 rounded-lg bg-green-500/5 border border-green-500/20">
        <UIcon name="i-lucide-check-circle" class="size-4 text-green-500 shrink-0 mt-0.5" />
        <p class="text-xs text-(--ui-text-muted)">
          {{ result.actualService }} — {{ result.model }} on {{ result.device }}
        </p>
      </div>
      <div v-if="result && !result.success" class="flex items-start gap-2 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
        <UIcon name="i-lucide-alert-circle" class="size-4 text-red-500 shrink-0 mt-0.5" />
        <p class="text-xs text-(--ui-text-muted)">{{ result.error }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  envValues: Record<string, string>
  vars: { key: string; label: string; sensitive: boolean }[]
}>();

const toast = useToast();
const revealed = ref<Record<string, boolean>>({});

const providerOptions = [
  { label: "Parakeet (Local)", value: "parakeet" },
  { label: "Whisper (Local)", value: "whisper" },
  { label: "Google Cloud Speech", value: "google" },
  { label: "Custom (WebSocket)", value: "custom" },
];

const deviceOptions = [
  { label: "GPU (cuda)", value: "cuda" },
  { label: "CPU", value: "cpu" },
];

const provider = computed(() =>
  (props.envValues.TRANSCRIPTION_PROVIDER || "parakeet").toLowerCase()
);
const isGoogle = computed(() => provider.value === "google");
const isLocalWs = computed(() => provider.value !== "google");

// Filter out GOOGLE_CREDENTIALS_JSON from standard vars (handled by custom UI)
const standardVars = computed(() =>
  props.vars.filter((v) => v.key !== "GOOGLE_CREDENTIALS_JSON")
);

// --- Google credentials (paste JSON → base64 in envValues) ---
const googleJsonInput = ref("");
const googleFileInput = ref<HTMLInputElement | null>(null);

const googleSummary = computed(() => {
  const b64 = props.envValues.GOOGLE_CREDENTIALS_JSON;
  if (!b64) return null;
  try {
    const json = atob(b64);
    const parsed = JSON.parse(json);
    if (!parsed.project_id) return null;
    return { projectId: parsed.project_id, clientEmail: parsed.client_email || "" };
  } catch {
    return null;
  }
});

function applyGoogleCredentials() {
  const raw = googleJsonInput.value.trim();
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.type || !parsed.project_id) {
      toast.add({ title: "Invalid Credentials", description: "Missing required fields (type, project_id)", color: "error", icon: "i-lucide-alert-circle" });
      return;
    }
    props.envValues.GOOGLE_CREDENTIALS_JSON = btoa(raw);
    googleJsonInput.value = "";
    toast.add({ title: "Credentials Applied", description: `Project: ${parsed.project_id}`, color: "success", icon: "i-lucide-check" });
  } catch {
    toast.add({ title: "Invalid JSON", description: "Could not parse the pasted JSON", color: "error", icon: "i-lucide-alert-circle" });
  }
}

function handleGoogleFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    googleJsonInput.value = reader.result as string;
    applyGoogleCredentials();
  };
  reader.readAsText(file);
}

function clearGoogleCredentials() {
  props.envValues.GOOGLE_CREDENTIALS_JSON = "";
  googleJsonInput.value = "";
}

const providerLabel = computed(() => {
  const p = provider.value;
  if (p === "whisper") return "Whisper";
  if (p === "custom") return "Custom";
  return "Parakeet";
});

// --- Status (local service auto-detection) ---
const status = ref<"idle" | "checking" | "available" | "mismatch" | "unavailable">("idle");
const statusMessage = ref("");
const statusHint = ref("");
const statusActualService = ref("");

async function checkProvider() {
  if (!isLocalWs.value) {
    status.value = "idle";
    return;
  }

  status.value = "checking";
  statusMessage.value = "";
  statusHint.value = "";
  statusActualService.value = "";

  try {
    const res = await $fetch<any>("/api/setup/check-transcription", {
      method: "POST",
      body: {
        provider: props.envValues.TRANSCRIPTION_PROVIDER || "parakeet",
        wsUrl: props.envValues.TRANSCRIPTION_SERVICES?.split(",")[0]?.trim(),
      },
    });

    if (res.available && res.mismatch) {
      status.value = "mismatch";
      statusMessage.value = res.message || "";
      statusActualService.value = res.actualService || "";
    } else if (res.available) {
      status.value = "available";
      statusMessage.value = res.message || "";
    } else {
      status.value = "unavailable";
      statusMessage.value = res.message || "";
      statusHint.value = res.hint || "";
    }
  } catch {
    status.value = "unavailable";
    statusMessage.value = "Could not check service status";
  }
}

// Auto-check when provider or URL changes
watch(
  () => [props.envValues.TRANSCRIPTION_PROVIDER, props.envValues.TRANSCRIPTION_SERVICES] as const,
  () => {
    if (Object.keys(props.envValues).length > 0) {
      checkProvider();
    }
  },
);

// Check on mount
onMounted(() => checkProvider());

// --- Test ---
const testing = ref(false);
const result = ref<{
  success: boolean;
  error?: string;
  actualService?: string;
  model?: string;
  device?: string;
  mismatch?: boolean;
  mismatchMessage?: string;
} | null>(null);

const resultColor = computed(() => {
  if (!result.value) return "neutral";
  if (!result.value.success) return "error";
  if (result.value.mismatch) return "warning";
  return "success";
});
const resultIcon = computed(() => {
  if (!result.value) return "i-lucide-check";
  if (!result.value.success) return "i-lucide-x";
  if (result.value.mismatch) return "i-lucide-alert-triangle";
  return "i-lucide-check";
});
const resultLabel = computed(() => {
  if (!result.value) return "";
  if (!result.value.success) return "Failed";
  if (result.value.mismatch) return "Mismatch";
  return "Connected";
});

async function test() {
  testing.value = true;
  result.value = null;
  try {
    const prov = props.envValues.TRANSCRIPTION_PROVIDER || "parakeet";
    const res = await $fetch<any>("/api/setup/test-transcription", {
      method: "POST",
      body: {
        type: prov,
        url: props.envValues.TRANSCRIPTION_SERVICES?.split(",")[0]?.trim(),
      },
    });
    result.value = res;
    if (res.success && res.mismatch) {
      toast.add({ title: "Provider Mismatch", description: res.mismatchMessage, color: "warning", icon: "i-lucide-alert-triangle" });
    } else if (res.success) {
      const desc = res.model ? `${res.actualService} — ${res.model}` : `${providerLabel.value} is reachable`;
      toast.add({ title: "Transcription Connected", description: desc, color: "success", icon: "i-lucide-mic" });
    } else {
      toast.add({ title: "Transcription Test Failed", description: res.error || "Unknown error", color: "error", icon: "i-lucide-alert-circle" });
    }
  } catch (err: any) {
    const msg = err.data?.message || err.message || "Test failed";
    result.value = { success: false, error: msg };
    toast.add({ title: "Transcription Test Failed", description: msg, color: "error", icon: "i-lucide-alert-circle" });
  } finally {
    testing.value = false;
  }
}
</script>
