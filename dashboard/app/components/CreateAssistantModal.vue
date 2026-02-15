<template>
  <UModal v-model:open="open">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-plus" class="size-4 text-(--ui-primary)" />
            <span class="font-semibold text-(--ui-text-highlighted)">Create New Assistant</span>
          </div>
        </template>

        <div class="space-y-4">
          <UFormField label="Name">
            <UInput
              v-model="name"
              placeholder="My Custom Assistant"
              @input="autoSlug"
            />
          </UFormField>

          <UFormField label="Slug" hint="Used as folder name">
            <UInput
              v-model="slug"
              placeholder="my-custom-assistant"
              :color="slugError ? 'error' : undefined"
            />
            <template v-if="slugError" #error>{{ slugError }}</template>
          </UFormField>

          <UFormField label="Template" hint="Clone code and config from">
            <div class="space-y-2 mt-1">
              <button
                v-for="t in templateCards"
                :key="t.value"
                type="button"
                class="w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-all"
                :class="templateSlug === t.value
                  ? 'border-[var(--ui-primary)] bg-[color-mix(in_srgb,var(--ui-primary)_8%,transparent)]'
                  : 'border-[var(--ui-border)] hover:border-[var(--ui-border-accented)] hover:bg-[var(--ui-bg-elevated)]'"
                @click="templateSlug = t.value"
              >
                <UIcon
                  :name="t.icon"
                  class="size-4 mt-0.5 shrink-0"
                  :class="templateSlug === t.value ? 'text-(--ui-primary)' : 'text-(--ui-text-muted)'"
                />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium" :class="templateSlug === t.value ? 'text-(--ui-primary)' : 'text-(--ui-text)'">
                      {{ t.label }}
                    </span>
                    <UBadge v-if="t.mode" :label="t.mode" :color="t.mode === 'outbound' ? 'warning' : 'info'" variant="subtle" size="xs" />
                  </div>
                  <p v-if="t.description" class="text-xs text-(--ui-text-dimmed) mt-0.5 leading-relaxed">{{ t.description }}</p>
                </div>
                <UIcon
                  v-if="templateSlug === t.value"
                  name="i-lucide-check"
                  class="size-4 mt-0.5 shrink-0 text-(--ui-primary)"
                />
              </button>
            </div>
          </UFormField>

          <div v-if="error" class="flex items-center gap-2 text-sm text-(--ui-error)">
            <UIcon name="i-lucide-alert-circle" class="size-4 shrink-0" />
            {{ error }}
          </div>
        </div>

        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              label="Cancel"
              color="neutral"
              variant="ghost"
              @click="open = false"
            />
            <UButton
              label="Create"
              icon="i-lucide-plus"
              color="primary"
              :loading="creating"
              :disabled="!slug || !name || !!slugError"
              @click="create"
            />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>

<script setup lang="ts">
const props = defineProps<{
  templates: { slug: string; config: any }[];
}>();

const emit = defineEmits<{
  created: [slug: string];
}>();

const open = defineModel<boolean>({ default: false });

const name = ref("");
const slug = ref("");
const templateSlug = ref("direct-dial");
const creating = ref(false);
const error = ref("");
const slugError = ref("");

const iconMap: Record<string, string> = {
  "ivr-transfer": "i-lucide-phone-forwarded",
  "direct-dial": "i-lucide-phone-call",
  "auto-dialer-call": "i-lucide-phone-outgoing",
};

const templateCards = computed(() =>
  props.templates.map((t) => ({
    label: t.config?.name || t.slug,
    value: t.slug,
    description: t.config?.description || "",
    mode: t.config?.mode || "",
    icon: iconMap[t.slug] || "i-lucide-bot",
  }))
);

function autoSlug() {
  slug.value = name.value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  validateSlug();
}

function validateSlug() {
  if (!slug.value) {
    slugError.value = "";
    return;
  }
  if (!/^[a-z0-9-]+$/.test(slug.value)) {
    slugError.value = "Only lowercase letters, numbers, and hyphens";
    return;
  }
  if (slug.value === "base") {
    slugError.value = "Reserved slug";
    return;
  }
  if (props.templates.some((t) => t.slug === slug.value)) {
    slugError.value = "Already exists";
    return;
  }
  slugError.value = "";
}

watch(slug, validateSlug);

async function create() {
  if (!slug.value || !name.value || slugError.value) return;

  creating.value = true;
  error.value = "";

  try {
    await $fetch("/api/assistants/create", {
      method: "POST",
      body: {
        slug: slug.value,
        name: name.value,
        templateSlug: templateSlug.value,
      },
    });

    emit("created", slug.value);
    open.value = false;

    // Reset form
    name.value = "";
    slug.value = "";
    templateSlug.value = "direct-dial";
  } catch (e: any) {
    error.value = e.data?.message || "Failed to create assistant";
  } finally {
    creating.value = false;
  }
}
</script>
