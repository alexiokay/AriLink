<template>
  <div class="space-y-4">
    <!-- Info banner -->
    <div v-if="schema.infoBanner" class="flex items-center gap-2.5 px-4 py-3 rounded-lg bg-(--ui-primary)/8 border border-(--ui-primary)/20">
      <UIcon name="i-lucide-info" class="size-4 text-(--ui-primary) shrink-0" />
      <span class="text-xs text-(--ui-text-muted)">{{ schema.infoBanner }}</span>
    </div>

    <!-- General Info (always shown) -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-info" class="size-4 text-(--ui-primary)" />
          <span class="text-sm font-semibold text-(--ui-text-highlighted)">General Info</span>
        </div>
      </template>
      <div class="flex flex-wrap items-start gap-4">
        <UFormField label="Display Name" class="w-56">
          <UInput v-model="config.name" placeholder="My Assistant" icon="i-lucide-tag" />
        </UFormField>
        <UFormField label="Mode" class="w-36">
          <USelect
            v-model="config.mode"
            :items="[{ label: 'Incoming', value: 'incoming' }, { label: 'Outbound', value: 'outbound' }]"
          />
        </UFormField>
        <UFormField label="Language" class="w-32">
          <UInput v-model="config.language" placeholder="en-US" icon="i-lucide-languages" />
        </UFormField>
        <UFormField label="Brain" hint="Call handling engine" class="w-48">
          <USelect v-model="presetValue" :items="presetItems" />
        </UFormField>
      </div>
      <UFormField label="Description" class="mt-4">
        <UTextarea v-model="config.description" placeholder="What this assistant does..." :rows="2" autoresize resize class="w-full" />
      </UFormField>
    </UCard>

    <!-- Schema-driven sections -->
    <UCard v-for="section in schema.sections" :key="section.id">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon :name="section.icon" class="size-4 text-(--ui-primary)" />
          <div class="flex-1">
            <span class="text-sm font-semibold text-(--ui-text-highlighted)">{{ section.title }}</span>
            <p v-if="section.description" class="text-xs text-(--ui-text-dimmed) mt-0.5 font-normal">{{ section.description }}</p>
          </div>
        </div>
      </template>
      <div class="flex flex-wrap items-start gap-x-6 gap-y-5">
        <div
          v-for="field in section.fields"
          :key="field.key"
          :class="field.width || 'w-48'"
        >
          <label class="block text-xs font-medium text-(--ui-text-muted) mb-1">{{ field.label }}</label>

          <!-- Text input -->
          <UInput
            v-if="field.type === 'text'"
            :model-value="getVal(field.key) ?? ''"
            :placeholder="field.placeholder"
            @update:model-value="(v: any) => setVal(field.key, v)"
          />

          <!-- Number input -->
          <UInput
            v-else-if="field.type === 'number'"
            :model-value="getVal(field.key) ?? field.defaultValue ?? ''"
            type="number"
            :min="field.min"
            :max="field.max"
            :step="field.step"
            :placeholder="field.placeholder"
            @update:model-value="(v: any) => setVal(field.key, Number(v))"
          />

          <!-- Password input -->
          <UInput
            v-else-if="field.type === 'password'"
            :model-value="getVal(field.key) ?? ''"
            :type="showPassword[field.key] ? 'text' : 'password'"
            :placeholder="field.placeholder"
            @update:model-value="(v: any) => setVal(field.key, v)"
          >
            <template #trailing>
              <button
                type="button"
                class="text-(--ui-text-dimmed) hover:text-(--ui-text) transition-colors"
                tabindex="-1"
                @click="showPassword[field.key] = !showPassword[field.key]"
              >
                <UIcon :name="showPassword[field.key] ? 'i-lucide-eye-off' : 'i-lucide-eye'" class="size-3.5" />
              </button>
            </template>
          </UInput>

          <!-- Select -->
          <USelect
            v-else-if="field.type === 'select'"
            :model-value="getVal(field.key) ?? ''"
            :items="field.options || []"
            @update:model-value="(v: any) => setVal(field.key, v)"
          />

          <!-- Textarea -->
          <UTextarea
            v-else-if="field.type === 'textarea'"
            :model-value="getVal(field.key) ?? ''"
            :placeholder="field.placeholder"
            :rows="3"
            autoresize
            resize
            class="w-full"
            @update:model-value="(v: any) => setVal(field.key, v)"
          />

          <!-- Audio path input -->
          <UInput
            v-else-if="field.type === 'audio'"
            :model-value="getVal(field.key) ?? ''"
            :placeholder="field.placeholder"
            icon="i-lucide-audio-lines"
            @update:model-value="(v: any) => setVal(field.key, v)"
          />

          <p v-if="field.hint" class="text-[10px] text-(--ui-text-dimmed) mt-1 leading-tight">{{ field.hint }}</p>
        </div>
      </div>
    </UCard>

    <!-- Transfer Settings -->
    <div v-if="showTransferOrCampaign" class="flex flex-wrap gap-4">
      <UCard v-if="schema.showTransfer && config.transfer" class="flex-1 min-w-[16rem]">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-phone-forwarded" class="size-4 text-(--ui-primary)" />
            <span class="text-sm font-semibold text-(--ui-text-highlighted)">Transfer Settings</span>
          </div>
        </template>
        <div class="flex flex-wrap items-start gap-4">
          <UFormField label="Destination" class="w-48">
            <UInput v-model="config.transfer.destination" placeholder="Extension or Number" />
          </UFormField>
          <UFormField label="Outbound Trunk" class="w-48">
            <UInput v-model="config.transfer.trunk" placeholder="PJSIP/trunk-name" />
          </UFormField>
        </div>
      </UCard>

      <UCard v-if="schema.showCampaign && config.campaign" class="flex-1 min-w-[16rem]">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-pie-chart" class="size-4 text-(--ui-primary)" />
            <span class="text-sm font-semibold text-(--ui-text-highlighted)">Campaign Control</span>
          </div>
        </template>
        <div class="flex flex-wrap items-start gap-4">
          <UFormField label="Concurrency (1–50)" class="w-36">
            <UInput
              :model-value="config.campaign.maxConcurrent"
              type="number"
              :min="1"
              :max="50"
              @update:model-value="(v: any) => config.campaign.maxConcurrent = Number(v)"
            />
          </UFormField>
          <UFormField label="Default Trunk" class="w-48">
            <UInput v-model="config.campaign.trunk" placeholder="PJSIP/out-trunk" />
          </UFormField>
        </div>
      </UCard>
    </div>

    <!-- Generic fallback: Voice Prompts (keys not covered by schema) -->
    <UCard v-if="schema.showGenericFallback && uncoveredPromptKeys.length">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-message-square-quote" class="size-4 text-(--ui-primary)" />
          <span class="text-sm font-semibold text-(--ui-text-highlighted)">Voice Prompts</span>
        </div>
      </template>
      <div class="space-y-1">
        <div
          v-for="key in uncoveredPromptKeys"
          :key="key"
          class="prompt-row group flex items-center gap-4 px-3 py-2.5 rounded-lg transition-colors"
        >
          <span class="text-xs font-mono font-semibold text-(--ui-text-muted) w-28 shrink-0">{{ key }}</span>
          <UInput v-model="config.prompts[key]" class="flex-1" placeholder="sound:custom/file_name" variant="none" />
          <UIcon name="i-lucide-audio-lines" class="size-4 text-(--ui-text-dimmed) group-hover:text-(--ui-primary) transition-colors pr-1" />
        </div>
      </div>
    </UCard>

    <!-- Generic fallback: Behavioral Rules (keys not covered by schema) -->
    <UCard v-if="schema.showGenericFallback && uncoveredBehaviorKeys.length">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-activity" class="size-4 text-(--ui-primary)" />
          <span class="text-sm font-semibold text-(--ui-text-highlighted)">Behavioral Rules</span>
        </div>
      </template>
      <div class="flex flex-wrap items-start gap-x-6 gap-y-4">
        <UFormField
          v-for="key in uncoveredBehaviorKeys"
          :key="key"
          :label="genericBehaviorLabel(key)"
          class="w-44"
        >
          <UInput
            :model-value="config.behavior[key]"
            :type="isNumericBehavior(key) ? 'number' : 'text'"
            :min="GENERIC_BEHAVIOR_BOUNDS[key]?.min"
            :max="GENERIC_BEHAVIOR_BOUNDS[key]?.max"
            @update:model-value="(v: any) => config.behavior[key] = isNumericBehavior(key) ? Number(v) : v"
          />
        </UFormField>
      </div>
    </UCard>
  </div>
</template>

<script setup lang="ts">
import { computed, watch, reactive } from "vue";
import {
  getBrainSchema,
  getNestedValue,
  setNestedValue,
  ensureDefaults,
  getCoveredKeys,
  LLM_PROVIDER_PRESETS,
} from "~/composables/useBrainConfigSchema";

const props = defineProps<{
  modelValue: any;
  brain: string | null;
  slug: string;
  availableBrains: { slug: string; file: string }[];
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: any): void;
}>();

// Direct reference to the config object (mutated in place, same as before)
const config = computed(() => props.modelValue);

// Derive schema from the brain prop (which tracks editConfig.brain via parent binding)
const schema = computed(() => getBrainSchema(props.brain));

// Password visibility toggles
const showPassword = reactive<Record<string, boolean>>({});

// Preset (brain) selector
const presetItems = computed(() => [
  { label: "None (custom code)", value: "none" },
  ...props.availableBrains.map((b) => ({ label: b.slug, value: b.slug })),
]);

const presetValue = computed({
  get: () => config.value.brain || "none",
  set: (v: string) => {
    config.value.brain = v === "none" ? undefined : v;
  },
});

// Generic fallback helpers (for custom code assistants)
const GENERIC_BEHAVIOR_BOUNDS: Record<string, { min: number; max: number }> = {
  maxRetries: { min: 0, max: 100 },
  timeoutSeconds: { min: 1, max: 300 },
  silenceThresholdSeconds: { min: 1, max: 60 },
  maxNoMatches: { min: 1, max: 100 },
  tryAgainInterval: { min: 1, max: 50 },
};

const GENERIC_BEHAVIOR_LABELS: Record<string, string> = {
  maxRetries: "Max Retries",
  timeoutSeconds: "Timeout (s)",
  silenceThresholdSeconds: "Silence Threshold (s)",
  maxNoMatches: "Max No-Matches",
  tryAgainInterval: "Try Again Interval",
  transferDigit: "Transfer Digit",
};

function isNumericBehavior(key: string): boolean {
  return key in GENERIC_BEHAVIOR_BOUNDS;
}

function genericBehaviorLabel(key: string): string {
  const label = GENERIC_BEHAVIOR_LABELS[key] || key;
  const bounds = GENERIC_BEHAVIOR_BOUNDS[key];
  return bounds ? `${label} (${bounds.min}–${bounds.max})` : label;
}

// Covered keys — exclude from generic fallback
const coveredKeys = computed(() => getCoveredKeys(schema.value));

const uncoveredPromptKeys = computed(() => {
  if (!config.value.prompts) return [];
  return Object.keys(config.value.prompts).filter(
    (k) => !coveredKeys.value.has(`prompts.${k}`)
  );
});

const uncoveredBehaviorKeys = computed(() => {
  if (!config.value.behavior) return [];
  return Object.keys(config.value.behavior).filter(
    (k) => !coveredKeys.value.has(`behavior.${k}`)
  );
});

// Show transfer/campaign wrapper div
const showTransferOrCampaign = computed(() => {
  return (schema.value.showTransfer && config.value.transfer) ||
    (schema.value.showCampaign && config.value.campaign);
});

// Nested value helpers for schema-driven fields
function getVal(path: string): any {
  return getNestedValue(config.value, path);
}

function setVal(path: string, value: any): void {
  setNestedValue(config.value, path, value);
}

// When brain changes, ensure defaults for the new schema
watch(
  () => props.brain,
  (newBrain) => {
    const newSchema = getBrainSchema(newBrain);
    ensureDefaults(config.value, newSchema);
  }
);

// LLM Chat: auto-fill endpoint/model when provider changes
watch(
  () => (config.value as any)?.behavior?.llmProvider,
  (newProvider: string | undefined, oldProvider: string | undefined) => {
    if (!newProvider || newProvider === oldProvider) return;
    const preset = LLM_PROVIDER_PRESETS[newProvider];
    if (!preset) return;

    const oldPreset = oldProvider ? LLM_PROVIDER_PRESETS[oldProvider] : null;
    const currentEndpoint = getNestedValue(config.value, "behavior.llmEndpoint");
    const currentModel = getNestedValue(config.value, "behavior.llmModel");

    // Only auto-fill if current value is empty or still at old provider's default
    if (!currentEndpoint || currentEndpoint === oldPreset?.endpoint) {
      setNestedValue(config.value, "behavior.llmEndpoint", preset.endpoint);
    }
    if (!currentModel || currentModel === oldPreset?.model) {
      setNestedValue(config.value, "behavior.llmModel", preset.model);
    }
  }
);
</script>

<style scoped>
.prompt-row {
  border: 1px solid transparent;
}
.prompt-row:hover {
  background-color: var(--ui-bg-elevated);
  border-color: var(--ui-border);
}
</style>
