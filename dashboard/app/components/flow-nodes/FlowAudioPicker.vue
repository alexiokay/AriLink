<template>
  <div class="flow-audio-picker">
    <div class="flex items-center gap-1">
      <UIcon name="i-lucide-audio-lines" class="size-3 text-(--ui-text-dimmed) shrink-0" />
      <input
        v-model="audioValue"
        class="flow-audio-picker__input"
        placeholder="custom/welcome"
        :list="datalistId"
        @mousedown.stop
        @input="$emit('update:modelValue', audioValue)"
      />
      <button
        v-if="audioValue"
        class="flow-audio-picker__clear"
        title="Clear"
        @click.stop="audioValue = ''; $emit('update:modelValue', '')"
        @mousedown.stop
      >×</button>
    </div>
    <datalist :id="datalistId">
      <option v-for="s in sounds" :key="s" :value="s" />
    </datalist>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue?: string;
  slug?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const datalistId = `audio-list-${Math.random().toString(36).slice(2, 8)}`;
const audioValue = ref(props.modelValue || '');

// Fetch available custom sounds once
const sounds = ref<string[]>([]);

async function fetchSounds() {
  try {
    const data: any = await $fetch('/api/assets/list', {
      query: { path: 'custom' },
    });
    if (data.items) {
      sounds.value = data.items
        .filter((i: any) => !i.isDirectory)
        .map((i: any) => {
          // Strip extension for Asterisk-style reference
          const name = i.name.replace(/\.(wav|sln16|gsm|alaw|ulaw|g722|sln)$/, '');
          return `custom/${name}`;
        })
        .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i); // dedupe
    }
  } catch {
    // Sounds not available — user can still type manually
  }
}

watch(() => props.modelValue, (v) => {
  audioValue.value = v || '';
});

onMounted(fetchSounds);
</script>

<style scoped>
.flow-audio-picker__input {
  width: 100%;
  font-size: 10px;
  font-family: ui-monospace, monospace;
  padding: 2px 4px;
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  background: var(--ui-bg);
  color: var(--ui-text);
  outline: none;
}
.flow-audio-picker__input:focus {
  border-color: var(--ui-primary);
}
.flow-audio-picker__clear {
  font-size: 11px;
  color: var(--ui-text-dimmed);
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
}
.flow-audio-picker__clear:hover {
  color: var(--ui-error);
}
</style>
