<template>
  <div class="grid grid-cols-3 gap-1">
    <UButton
      v-for="key in keys"
      :key="key.digit"
      :label="key.digit"
      color="neutral"
      variant="soft"
      size="lg"
      class="font-mono text-lg justify-center"
      @click="$emit('press', key.digit)"
    />
  </div>
</template>

<script setup lang="ts">
defineEmits<{
  press: [digit: string];
}>();

const keys = [
  { digit: "1" }, { digit: "2" }, { digit: "3" },
  { digit: "4" }, { digit: "5" }, { digit: "6" },
  { digit: "7" }, { digit: "8" }, { digit: "9" },
  { digit: "*" }, { digit: "0" }, { digit: "#" },
];
</script>
