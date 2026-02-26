<template>
  <div class="space-y-4">
    <!-- Provider selector -->
    <UFormField label="Provider">
      <template #hint>
        <span class="text-[10px] font-mono text-muted-foreground opacity-50 bg-(--ui-bg-elevated) px-1.5 py-0.5 rounded">TTS_PROVIDER</span>
      </template>
      <USelect
        v-model="envValues['TTS_PROVIDER']"
        :items="providerOptions"
        class="font-mono text-sm"
      />
    </UFormField>

    <!-- Local TTS status indicator (Kokoro / Custom) -->
    <div v-if="isLocalWs && status === 'checking'" class="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--ui-bg-elevated)/40 border border-(--ui-border)">
      <UIcon name="i-lucide-loader-2" class="size-4 text-(--ui-text-dimmed) animate-spin" />
      <span class="text-xs text-(--ui-text-dimmed)">Checking TTS service...</span>
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

    <!-- Standard env var fields -->
    <UFormField
      v-for="v in vars"
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

    <!-- ElevenLabs model/voice pickers -->
    <div v-if="isElevenLabs" class="space-y-3">
      <!-- Model picker -->
      <UFormField label="ElevenLabs Model">
        <template #hint>
          <span class="text-[10px] font-mono text-muted-foreground opacity-50 bg-(--ui-bg-elevated) px-1.5 py-0.5 rounded">ELEVENLABS_MODEL</span>
        </template>
        <div class="flex items-center gap-2">
          <USelect
            v-if="elModels.length > 0"
            v-model="envValues['ELEVENLABS_MODEL']"
            :items="elModelOptions"
            placeholder="Select model..."
            class="flex-1 font-mono text-sm"
          />
          <UInput
            v-else
            v-model="envValues['ELEVENLABS_MODEL']"
            placeholder="eleven_flash_v2_5"
            class="flex-1 font-mono text-sm"
          />
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            size="xs"
            :loading="elModelsLoading"
            @click="fetchElModels"
          />
        </div>
      </UFormField>

      <!-- Voice picker -->
      <UFormField label="ElevenLabs Voice">
        <template #hint>
          <span class="text-[10px] font-mono text-muted-foreground opacity-50 bg-(--ui-bg-elevated) px-1.5 py-0.5 rounded">ELEVENLABS_VOICE_ID</span>
        </template>
        <div class="flex items-center gap-2">
          <USelect
            v-if="elVoices.length > 0"
            v-model="envValues['ELEVENLABS_VOICE_ID']"
            :items="elVoiceOptions"
            placeholder="Select voice..."
            class="flex-1 font-mono text-sm"
          />
          <UInput
            v-else
            v-model="envValues['ELEVENLABS_VOICE_ID']"
            placeholder="21m00Tcm4TlvDq8ikWAM"
            class="flex-1 font-mono text-sm"
          />
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            size="xs"
            :loading="elVoicesLoading"
            @click="fetchElVoices"
          />
        </div>
      </UFormField>
    </div>

    <!-- Test TTS button -->
    <div class="pt-3 mt-1 border-t border-(--ui-border) space-y-2">
      <div class="flex items-center gap-3">
        <UButton
          label="Test TTS"
          icon="i-lucide-volume-2"
          color="primary"
          variant="soft"
          size="sm"
          :loading="testing"
          @click="testTts"
        />
        <UBadge v-if="result" :color="result.success ? 'success' : 'error'" variant="subtle">
          <UIcon :name="result.success ? 'i-lucide-check' : 'i-lucide-x'" class="size-3 mr-1" />
          {{ result.success ? (result.provider || 'Connected') : 'Failed' }}
        </UBadge>
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
  { label: "Kokoro (Local)", value: "kokoro" },
  { label: "ElevenLabs (Cloud)", value: "elevenlabs" },
  { label: "Custom (WebSocket)", value: "custom" },
];

const provider = computed(() =>
  (props.envValues.TTS_PROVIDER || "kokoro").toLowerCase()
);
const isElevenLabs = computed(() => provider.value === "elevenlabs");
const isLocalWs = computed(() => provider.value === "kokoro" || provider.value === "custom");

// --- Kokoro Status ---
const status = ref<"idle" | "checking" | "available" | "unavailable">("idle");
const statusMessage = ref("");
const statusHint = ref("");

async function checkProvider() {
  if (!isLocalWs.value) {
    status.value = "idle";
    return;
  }

  status.value = "checking";
  statusMessage.value = "";
  statusHint.value = "";

  try {
    const res = await $fetch<any>("/api/setup/check-tts", {
      method: "POST",
      body: { provider: "kokoro", wsUrl: props.envValues.TTS_SERVICE },
    });

    status.value = res.available ? "available" : "unavailable";
    statusMessage.value = res.message || "";
    statusHint.value = res.hint || "";
  } catch {
    status.value = "unavailable";
    statusMessage.value = "Could not check service status";
  }
}

watch(
  () => [props.envValues.TTS_PROVIDER, props.envValues.TTS_SERVICE] as const,
  () => {
    if (Object.keys(props.envValues).length > 0) {
      checkProvider();
    }
  },
);

onMounted(() => checkProvider());

// --- ElevenLabs Models/Voices ---
const elModels = ref<{ id: string; name: string; description: string; languages: number }[]>([]);
const elModelsLoading = ref(false);
const elModelOptions = computed(() =>
  elModels.value.map((m) => ({
    label: `${m.name} (${m.languages} langs)`,
    value: m.id,
  }))
);

const elVoices = ref<{ id: string; name: string; category: string }[]>([]);
const elVoicesLoading = ref(false);
const elVoiceOptions = computed(() =>
  elVoices.value.map((v) => ({
    label: `${v.name} (${v.category})`,
    value: v.id,
  }))
);

const MASK = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";

function getElApiKeyQuery(): Record<string, string> {
  const key = props.envValues.ELEVENLABS_API_KEY;
  if (!key || key === MASK) return {};
  return { apiKey: key };
}

async function fetchElModels() {
  elModelsLoading.value = true;
  try {
    const data = await $fetch<any>("/api/setup/elevenlabs-models", { query: getElApiKeyQuery() });
    if (data.success) {
      elModels.value = data.models;
    } else {
      toast.add({ title: "Failed to fetch models", description: data.error, color: "error", icon: "i-lucide-alert-circle" });
    }
  } catch (err: any) {
    toast.add({ title: "Failed to fetch models", description: err.message, color: "error", icon: "i-lucide-alert-circle" });
  } finally {
    elModelsLoading.value = false;
  }
}

async function fetchElVoices() {
  elVoicesLoading.value = true;
  try {
    const data = await $fetch<any>("/api/setup/elevenlabs-voices", { query: getElApiKeyQuery() });
    if (data.success) {
      elVoices.value = data.voices;
    } else {
      toast.add({ title: "Failed to fetch voices", description: data.error, color: "error", icon: "i-lucide-alert-circle" });
    }
  } catch (err: any) {
    toast.add({ title: "Failed to fetch voices", description: err.message, color: "error", icon: "i-lucide-alert-circle" });
  } finally {
    elVoicesLoading.value = false;
  }
}

// Auto-fetch ElevenLabs models/voices when provider is elevenlabs
watch(
  () => [props.envValues.TTS_PROVIDER, props.envValues.ELEVENLABS_API_KEY] as const,
  ([provider, key]) => {
    if (provider?.toLowerCase() === "elevenlabs" && key) {
      if (elModels.value.length === 0) fetchElModels();
      if (elVoices.value.length === 0) fetchElVoices();
    }
  },
);

// --- Test TTS ---
const testing = ref(false);
const result = ref<{ success: boolean; error?: string; provider?: string; audioBase64?: string; audioMime?: string } | null>(null);

async function testTts() {
  testing.value = true;
  result.value = null;
  try {
    const res = await $fetch<any>("/api/setup/test-tts", {
      method: "POST",
      body: {
        provider: props.envValues.TTS_PROVIDER || "kokoro",
        wsUrl: props.envValues.TTS_SERVICE,
        apiKey: props.envValues.ELEVENLABS_API_KEY,
        voiceId: props.envValues.ELEVENLABS_VOICE_ID,
        model: props.envValues.ELEVENLABS_MODEL,
      },
    });
    result.value = res;

    if (res.success) {
      toast.add({ title: "TTS Connected", description: res.provider || "Service is reachable", color: "success", icon: "i-lucide-volume-2" });
      if (res.audioBase64) {
        const mime = res.audioMime || "audio/mpeg";
        const audio = new Audio(`data:${mime};base64,${res.audioBase64}`);
        audio.play().catch(() => {});
      }
    } else {
      toast.add({ title: "TTS Test Failed", description: res.error || "Unknown error", color: "error", icon: "i-lucide-alert-circle" });
    }
  } catch (err: any) {
    const msg = err.data?.message || err.message || "Test failed";
    result.value = { success: false, error: msg };
    toast.add({ title: "TTS Test Failed", description: msg, color: "error", icon: "i-lucide-alert-circle" });
  } finally {
    testing.value = false;
  }
}
</script>
