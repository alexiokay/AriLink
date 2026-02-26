<template>
  <div class="space-y-4">
    <!-- Provider selector -->
    <UFormField label="Provider">
      <template #hint>
        <span class="text-[10px] font-mono text-muted-foreground opacity-50 bg-(--ui-bg-elevated) px-1.5 py-0.5 rounded">LLM_PROVIDER</span>
      </template>
      <USelect
        v-model="envValues['LLM_PROVIDER']"
        :items="providerOptions"
        class="font-mono text-sm"
      />
    </UFormField>

    <!-- Standard env var fields (filtered by parent) -->
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
          :placeholder="placeholders[v.key] || ''"
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

    <!-- Test LLM button -->
    <div class="pt-3 mt-1 border-t border-(--ui-border) space-y-2">
      <div class="flex items-center gap-3">
        <UButton
          label="Test LLM"
          icon="i-lucide-sparkles"
          color="primary"
          variant="soft"
          size="sm"
          :loading="testing"
          @click="testLlm"
        />
        <UBadge v-if="result" :color="result.success ? 'success' : 'error'" variant="subtle">
          <UIcon :name="result.success ? 'i-lucide-check' : 'i-lucide-x'" class="size-3 mr-1" />
          {{ result.success ? (result.model || 'Connected') : 'Failed' }}
        </UBadge>
      </div>
      <div v-if="result?.success && result.response" class="flex items-start gap-2 p-3 rounded-lg bg-green-500/5 border border-green-500/20">
        <UIcon name="i-lucide-message-circle" class="size-4 text-green-500 shrink-0 mt-0.5" />
        <div>
          <p class="text-xs font-medium text-(--ui-text-muted)">LLM responded:</p>
          <p class="text-sm text-(--ui-text-highlighted)">"{{ result.response }}"</p>
        </div>
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
  { label: "Ollama (Local)", value: "ollama" },
  { label: "Google Gemini", value: "gemini" },
  { label: "OpenAI", value: "openai" },
  { label: "OpenRouter", value: "openrouter" },
  { label: "Custom (OpenAI-compatible)", value: "custom" },
];

const provider = computed(() =>
  (props.envValues.LLM_PROVIDER || "ollama").toLowerCase()
);

// Dynamic placeholders per provider
const placeholders = computed<Record<string, string>>(() => {
  const p = provider.value;
  const map: Record<string, string> = {};

  if (p === "ollama") {
    map.LLM_ENDPOINT = "http://localhost:11434";
    map.LLM_MODEL = "llama3.2";
  } else if (p === "gemini") {
    map.LLM_MODEL = "gemini-3-flash-preview";
  } else if (p === "openai") {
    map.LLM_MODEL = "gpt-4o-mini";
  } else if (p === "openrouter") {
    map.LLM_MODEL = "anthropic/claude-sonnet-4-20250514";
  } else {
    map.LLM_ENDPOINT = "http://localhost:11434";
    map.LLM_MODEL = "model-name";
  }

  return map;
});

// --- Test LLM ---
const testing = ref(false);
const result = ref<{ success: boolean; error?: string; model?: string; response?: string } | null>(null);

async function testLlm() {
  testing.value = true;
  result.value = null;
  try {
    result.value = await $fetch("/api/setup/test-llm", {
      method: "POST",
      body: {
        provider: props.envValues.LLM_PROVIDER || "ollama",
        endpoint: props.envValues.LLM_ENDPOINT,
        model: props.envValues.LLM_MODEL,
        apiKey: props.envValues.LLM_API_KEY,
      },
    });
    if (result.value?.success) {
      toast.add({ title: "LLM Connected", description: result.value.model || "Model responded", color: "success", icon: "i-lucide-sparkles" });
    } else {
      toast.add({ title: "LLM Test Failed", description: result.value?.error || "Unknown error", color: "error", icon: "i-lucide-alert-circle" });
    }
  } catch (err: any) {
    const msg = err.data?.message || err.message || "Test failed";
    result.value = { success: false, error: msg };
    toast.add({ title: "LLM Test Failed", description: msg, color: "error", icon: "i-lucide-alert-circle" });
  } finally {
    testing.value = false;
  }
}
</script>
