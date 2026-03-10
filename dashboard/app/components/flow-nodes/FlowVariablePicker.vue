<template>
  <div class="var-picker nodrag nowheel nopan" :class="{ 'var-picker--open': showDropdown }" @mousedown.stop @pointerdown.stop>
    <input
      ref="inputEl"
      :value="modelValue"
      class="flow-node__text-input font-mono"
      :placeholder="placeholder"
      @input="onInput"
      @focus="showDropdown = true"
      @blur="onBlur"
      @mousedown.stop
      @keydown.down.prevent="moveSelection(1)"
      @keydown.up.prevent="moveSelection(-1)"
      @keydown.enter.prevent="confirmSelection"
      @keydown.escape="showDropdown = false"
    />
    <div v-if="showDropdown && filteredVars.length" class="var-picker__dropdown">
      <div
        v-for="(v, idx) in filteredVars"
        :key="v.name"
        class="var-picker__option"
        :class="{ 'var-picker__option--selected': idx === selectedIdx, 'var-picker__option--builtin': v.builtin }"
        @mousedown.prevent="selectVar(v.name)"
      >
        <code class="var-picker__name">{{ v.name }}</code>
        <span class="var-picker__source">{{ v.source }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject } from 'vue';

interface FlowVariable {
  name: string;
  source: string;
  builtin: boolean;
}

const props = withDefaults(defineProps<{
  modelValue: string;
  placeholder?: string;
  nodeId?: string;
}>(), {
  placeholder: 'variable',
  nodeId: undefined,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const inputEl = ref<HTMLInputElement>();
const showDropdown = ref(false);
const selectedIdx = ref(0);

// Inject available variables from parent FlowBuilder (accepts optional nodeId for upstream filtering)
const availableVars = inject<(nodeId?: string) => FlowVariable[]>('flowVariables', () => []);

const filteredVars = computed(() => {
  const vars = availableVars(props.nodeId);
  const query = (props.modelValue || '').toLowerCase();
  if (!query) return vars;
  return vars.filter((v) => v.name.toLowerCase().includes(query));
});

function onInput(e: Event) {
  const val = (e.target as HTMLInputElement).value;
  emit('update:modelValue', val);
  showDropdown.value = true;
  selectedIdx.value = 0;
}

function selectVar(name: string) {
  emit('update:modelValue', name);
  showDropdown.value = false;
}

function onBlur() {
  // Small delay so mousedown on option fires first
  setTimeout(() => { showDropdown.value = false; }, 150);
}

function moveSelection(delta: number) {
  const len = filteredVars.value.length;
  if (!len) return;
  selectedIdx.value = (selectedIdx.value + delta + len) % len;
}

function confirmSelection() {
  const vars = filteredVars.value;
  if (vars.length > 0) {
    const idx = Math.min(selectedIdx.value, vars.length - 1);
    selectVar(vars[idx]!.name);
  }
}
</script>

<style scoped>
.var-picker {
  position: relative;
  flex: 1;
  min-width: 0;
}

.var-picker__dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 50;
  margin-top: 2px;
  background: var(--ui-bg-elevated);
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,.15);
  max-height: 160px;
  overflow-y: auto;
  padding: 2px;
}

.var-picker__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.1s;
}
.var-picker__option:hover,
.var-picker__option--selected {
  background: color-mix(in srgb, var(--ui-primary) 10%, transparent);
}

.var-picker__name {
  font-size: 10px;
  font-weight: 600;
  color: var(--ui-primary);
}

.var-picker__source {
  font-size: 9px;
  color: var(--ui-text-dimmed);
  white-space: nowrap;
}

.var-picker__option--builtin .var-picker__source {
  color: var(--ui-text-muted);
  font-style: italic;
}
</style>
