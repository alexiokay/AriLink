<template>
  <UModal v-model:open="open">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-phone-forwarded" class="size-5 text-(--ui-primary)" />
        <span class="font-semibold">Transfer Call</span>
      </div>
    </template>

    <template #body>
      <div class="space-y-4">
        <!-- Manual input -->
        <div>
          <label class="text-sm font-medium text-(--ui-text-muted) mb-1 block">Extension or SIP endpoint</label>
          <div class="flex gap-2">
            <UInput
              v-model="manualEndpoint"
              placeholder="e.g. 100, +48123456789, PJSIP/100"
              class="flex-1 font-mono"
              icon="i-lucide-phone"
              autofocus
              @keyup.enter="confirmManual"
            />
            <UButton
              label="Transfer"
              color="primary"
              :disabled="!manualEndpoint.trim()"
              @click="confirmManual"
            />
          </div>
        </div>

        <!-- Search filter -->
        <UInput
          v-model="search"
          placeholder="Search extensions or contacts..."
          icon="i-lucide-search"
          size="sm"
        />

        <!-- Extensions error -->
        <div v-if="extensionsError && !loading" class="px-3 py-2 rounded-md bg-(--ui-error)/5 border border-(--ui-error)/15">
          <p class="text-sm text-(--ui-error)">{{ extensionsError }}</p>
        </div>

        <!-- Extensions from Asterisk -->
        <div v-if="filteredExtensions.length > 0">
          <p class="text-xs font-medium text-(--ui-text-dimmed) uppercase tracking-wide mb-2">
            PBX Extensions
            <UBadge :label="String(filteredExtensions.length)" color="neutral" variant="subtle" size="xs" class="ml-1" />
          </p>
          <div class="space-y-1 max-h-40 overflow-y-auto">
            <button
              v-for="ext in filteredExtensions"
              :key="ext.resource"
              class="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-(--ui-bg-accented) transition-colors text-left"
              @click="selectEndpoint(ext.resource)"
            >
              <UIcon name="i-lucide-phone" class="size-4 shrink-0" :class="ext.state === 'online' ? 'text-(--ui-success)' : 'text-(--ui-text-dimmed)'" />
              <span class="font-mono text-sm text-(--ui-text-highlighted)">{{ ext.resource }}</span>
              <UBadge
                :label="ext.state"
                :color="ext.state === 'online' ? 'success' : ext.channel_ids.length > 0 ? 'warning' : 'neutral'"
                variant="subtle"
                size="xs"
              />
              <span v-if="ext.channel_ids.length > 0" class="text-xs text-(--ui-text-dimmed) ml-auto">
                {{ ext.channel_ids.length }} active
              </span>
            </button>
          </div>
        </div>

        <!-- Contacts -->
        <div v-if="filteredContacts.length > 0">
          <p class="text-xs font-medium text-(--ui-text-dimmed) uppercase tracking-wide mb-2">
            Contacts
            <UBadge :label="String(filteredContacts.length)" color="neutral" variant="subtle" size="xs" class="ml-1" />
          </p>
          <div class="space-y-1 max-h-40 overflow-y-auto">
            <button
              v-for="(contact, i) in filteredContacts"
              :key="i"
              class="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-(--ui-bg-accented) transition-colors text-left"
              @click="selectEndpoint(contact.phone)"
            >
              <UIcon name="i-lucide-user" class="size-4 text-(--ui-text-dimmed) shrink-0" />
              <div class="flex-1 min-w-0">
                <span class="text-sm text-(--ui-text-highlighted) truncate block">{{ contact.name || contact.phone }}</span>
                <span v-if="contact.name" class="text-xs text-(--ui-text-dimmed) font-mono">{{ contact.phone }}</span>
              </div>
              <span v-if="contact.listName" class="text-xs text-(--ui-text-dimmed)">{{ contact.listName }}</span>
            </button>
          </div>
        </div>

        <!-- Loading / empty -->
        <div v-if="loading" class="py-4 text-center">
          <UIcon name="i-lucide-loader-2" class="size-5 text-(--ui-text-dimmed) mx-auto animate-spin" />
          <p class="text-sm text-(--ui-text-muted) mt-1">Loading extensions...</p>
        </div>
        <div v-else-if="filteredExtensions.length === 0 && filteredContacts.length === 0 && search" class="py-4 text-center">
          <p class="text-sm text-(--ui-text-dimmed)">No matches for "{{ search }}"</p>
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
interface Extension {
  resource: string;
  tech: string;
  state: string;
  channel_ids: string[];
}

interface Contact {
  phone: string;
  name: string;
  listName?: string;
}

const open = defineModel<boolean>("open", { default: false });

const emit = defineEmits<{
  select: [endpoint: string];
}>();

const manualEndpoint = ref("");
const search = ref("");
const loading = ref(false);
const extensions = ref<Extension[]>([]);
const contacts = ref<Contact[]>([]);
const extensionsError = ref("");

const filteredExtensions = computed(() => {
  if (!search.value) return extensions.value;
  const q = search.value.toLowerCase();
  return extensions.value.filter((e) =>
    e.resource.toLowerCase().includes(q)
  );
});

const filteredContacts = computed(() => {
  if (!search.value) return contacts.value;
  const q = search.value.toLowerCase();
  return contacts.value.filter((c) =>
    c.name.toLowerCase().includes(q) ||
    c.phone.toLowerCase().includes(q) ||
    (c.listName || "").toLowerCase().includes(q)
  );
});

function confirmManual() {
  const ep = manualEndpoint.value.trim();
  if (!ep) return;
  emit("select", ep);
  open.value = false;
  manualEndpoint.value = "";
  search.value = "";
}

function selectEndpoint(endpoint: string) {
  emit("select", endpoint);
  open.value = false;
  manualEndpoint.value = "";
  search.value = "";
}

async function fetchData() {
  loading.value = true;
  extensionsError.value = "";
  try {
    const res = await fetch("/api/extensions");
    const data = await res.json();
    extensions.value = data.extensions || [];
    contacts.value = data.contacts || [];
    extensionsError.value = data.extensionsError || "";
  } catch (err) {
    console.error("[TransferModal] Failed to fetch extensions:", err);
    extensionsError.value = "Failed to reach server";
  } finally {
    loading.value = false;
  }
}

// Fetch when modal opens
watch(open, (val) => {
  if (val) {
    fetchData();
    manualEndpoint.value = "";
    search.value = "";
  }
});
</script>
