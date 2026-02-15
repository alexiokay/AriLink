<template>
  <div class="h-[calc(100vh-160px)] flex flex-col space-y-6 overflow-y-auto px-2 pb-10">
    <!-- Header Area -->
    <div class="flex items-center justify-between sticky top-0 z-20 p-4 bg-(--ui-bg-elevated)/80 backdrop-blur-sm rounded-xl border border-(--ui-border) shadow-sm">
      <div class="flex items-center gap-3">
        <div class="p-2 flex rounded-lg bg-primary/10">
          <UIcon name="i-lucide-settings" class="size-6 text-primary" />
        </div>
        <div>
          <h1 class="text-2xl font-bold text-(--ui-text-highlighted)">System Configuration</h1>
          <p class="text-xs text-muted-foreground">Manage service nodes and environment parameters</p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <NuxtLink to="/setup">
          <UButton
            label="Setup Wizard"
            icon="i-lucide-wand-sparkles"
            color="neutral"
            variant="ghost"
            size="sm"
          />
        </NuxtLink>
        <UButton
          label="Refresh State"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="emit('dashboard:refreshState')"
        />
        <div class="w-px h-6 bg-(--ui-border)" />
        <UButton
          label="Save Settings"
          icon="i-lucide-save"
          color="primary"
          size="md"
          :loading="envSaving"
          @click="saveEnv"
          class="px-6 font-semibold shadow-sm"
        />
      </div>
    </div>

    <!-- Dashboard Section (Service Status) -->
    <section class="space-y-4">
      <div class="flex items-center gap-2 px-2 pb-2 border-b border-(--ui-border)">
        <UIcon name="i-lucide-activity" class="size-4 text-primary" />
        <h2 class="text-sm font-bold uppercase tracking-wider text-muted-foreground">Service Dashboard</h2>
      </div>
      
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <!-- Assistant Selection -->
        <UCard class="border-(--ui-primary)/20 border-2 shadow-md">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-bot" class="size-4 text-primary" />
              <span class="font-bold text-sm">Active Assistant</span>
            </div>
          </template>
          <p class="text-xs text-(--ui-text-dimmed) mb-3">Default for all incoming calls (unless overridden by a routing rule below).</p>
          <div class="space-y-4 pt-1">
            <USelect
              v-model="assistant"
              :items="assistantOptions"
              placeholder="Select assistant"
              class="w-full"
            />
            <UButton
              block
              label="Switch Assistant"
              icon="i-lucide-rotate-cw"
              color="primary"
              variant="soft"
              size="sm"
              @click="updateAssistant"
            />
          </div>
        </UCard>

        <!-- Transcription Nodes -->
        <UCard class="shadow-sm">
          <template #header>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-mic-2" class="size-4 text-primary" />
                <span class="font-bold text-sm">Transcription Engine</span>
              </div>
              <UButton
                icon="i-lucide-rotate-cw"
                label="Restart"
                size="xs"
                variant="soft"
                @click="emit('dashboard:restartParakeet')"
              />
            </div>
          </template>
          <div v-if="transcriptionServices.length === 0" class="py-2 text-center">
            <p class="text-xs text-muted-foreground italic">No engine configured</p>
          </div>
          <div v-else class="space-y-3 pt-1">
            <div
              v-for="(svc, i) in transcriptionServices"
              :key="i"
              class="flex items-center justify-between p-2 rounded-lg bg-(--ui-bg-elevated)/40 border border-(--ui-border)"
            >
              <span class="text-xs font-mono font-bold">{{ svc }}</span>
              <UBadge
                :label="i === 0 ? 'Primary' : 'Failover'"
                :color="i === 0 ? 'success' : 'warning'"
                variant="subtle"
                size="xs"
              />
            </div>
          </div>
        </UCard>

        <!-- Node Info -->
        <UCard class="shadow-sm">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-info" class="size-4 text-primary" />
              <span class="font-bold text-sm">Interface Nodes</span>
            </div>
          </template>
          <div class="space-y-2 pt-1">
            <div
              v-for="(val, key) in serverConfig"
              :key="key"
              class="flex justify-between items-center px-2 py-1.5 rounded-md hover:bg-(--ui-bg-elevated)/30 transition-colors"
            >
              <span class="text-xs text-muted-foreground uppercase font-bold tracking-tight">{{ key }}</span>
              <span class="text-xs font-mono text-primary font-bold">{{ val }}</span>
            </div>
          </div>
        </UCard>
      </div>
    </section>

    <!-- Call Routing (incoming calls only — campaigns bypass this) -->
    <section class="space-y-4">
      <div class="flex items-center justify-between px-2 pb-2 border-b border-(--ui-border)">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-route" class="size-4 text-primary" />
          <h2 class="text-sm font-bold uppercase tracking-wider text-muted-foreground">Incoming Call Routing</h2>
        </div>
        <div class="flex items-center gap-2">
          <transition name="fade">
            <div v-if="routingMessage" class="flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border"
                 :class="routingError ? 'bg-error-50 border-error-200 text-error-600' : 'bg-success-50 border-success-200 text-success-600'">
              <UIcon :name="routingError ? 'i-lucide-alert-circle' : 'i-lucide-check-circle'" class="size-3" />
              {{ routingMessage }}
            </div>
          </transition>
          <UButton
            label="Save"
            icon="i-lucide-save"
            color="primary"
            variant="soft"
            size="sm"
            :loading="routingSaving"
            @click="saveRouting"
          />
        </div>
      </div>

      <UCard class="shadow-sm">
        <p class="text-xs text-(--ui-text-dimmed) mb-4">
          When a call comes in, these rules decide which assistant handles it.
          The <strong>Active Assistant</strong> above is used when no rule matches.
          Outbound campaigns always use their own assistant — these rules don't apply.
        </p>

        <!-- Routing rules table -->
        <div v-if="allRoutingRules.length === 0" class="text-center py-6">
          <UIcon name="i-lucide-route" class="size-8 text-(--ui-text-dimmed) mx-auto mb-2" />
          <p class="text-sm text-(--ui-text-dimmed)">No routing rules — all incoming calls go to the Active Assistant</p>
        </div>

        <table v-else class="w-full text-sm mb-4">
          <thead>
            <tr class="border-b border-(--ui-border)">
              <th class="text-left py-2 px-2 text-(--ui-text-muted) font-medium w-24">Match</th>
              <th class="text-left py-2 px-2 text-(--ui-text-muted) font-medium">Pattern</th>
              <th class="text-left py-2 px-2 text-(--ui-text-muted) font-medium">Assistant</th>
              <th class="w-10"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(rule, i) in allRoutingRules"
              :key="i"
              class="border-b border-(--ui-border) last:border-0"
            >
              <td class="py-1.5 px-2">
                <USelect
                  v-model="rule.type"
                  :items="[{ label: 'Extension', value: 'extension' }, { label: 'Caller ID', value: 'callerId' }]"
                  size="xs"
                  class="w-24"
                />
              </td>
              <td class="py-1.5 px-2">
                <UInput
                  v-model="rule.pattern"
                  :placeholder="rule.type === 'extension' ? 'e.g. 10[0-9]' : 'e.g. +4812.*'"
                  class="font-mono text-sm"
                  size="xs"
                />
              </td>
              <td class="py-1.5 px-2">
                <USelect
                  v-model="rule.assistant"
                  :items="allAssistantOptions"
                  placeholder="Select..."
                  size="xs"
                />
              </td>
              <td class="py-1.5 px-2 text-center">
                <UButton
                  icon="i-lucide-x"
                  color="error"
                  variant="ghost"
                  size="xs"
                  @click="allRoutingRules.splice(i, 1)"
                />
              </td>
            </tr>
          </tbody>
        </table>

        <UButton
          label="Add Rule"
          icon="i-lucide-plus"
          color="neutral"
          variant="soft"
          size="xs"
          @click="allRoutingRules.push({ type: 'extension', pattern: '', assistant: '' })"
        />
      </UCard>
    </section>

    <!-- Environment Variables Area -->
    <section class="space-y-6 pt-4">
      <div class="flex items-center justify-between px-2 pb-2 border-b border-(--ui-border)">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-list-tree" class="size-4 text-primary" />
          <h2 class="text-sm font-bold uppercase tracking-wider text-muted-foreground">Configuration Groups (.env)</h2>
        </div>
        <transition name="fade">
          <div v-if="envMessage" class="flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border"
               :class="envError ? 'bg-error-50 border-error-200 text-error-600' : 'bg-success-50 border-success-200 text-success-600'">
            <UIcon :name="envError ? 'i-lucide-alert-circle' : 'i-lucide-check-circle'" class="size-3" />
            {{ envMessage }}
          </div>
        </transition>
      </div>

      <div class="env-masonry">
        <UCard
          v-for="group in envGroups"
          :key="group.group"
          class="env-card shadow-sm border-transparent hover:border-(--ui-border-accentlow) transition-all duration-300"
        >
          <template #header>
            <div class="flex items-center gap-3">
              <div class="p-1.5 rounded-lg bg-primary/5">
                <UIcon :name="group.icon || 'i-lucide-box'" class="size-4 text-primary" />
              </div>
              <span class="font-bold text-(--ui-text-highlighted)">{{ group.group }}</span>
            </div>
          </template>

          <div class="space-y-4">
            <UFormField 
              v-for="v in group.vars" 
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
                  @click="toggleReveal(v.key)"
                  class="mr-1"
                />
              </div>
            </UFormField>
          </div>
        </UCard>
      </div>

      <div class="p-6 rounded-2xl bg-orange-50/10 border border-orange-200/20 text-orange-600/80">
        <div class="flex gap-3">
          <UIcon name="i-lucide-alert-triangle" class="size-5 shrink-0" />
          <div class="text-sm leading-relaxed">
            <p class="font-bold uppercase tracking-widest mb-1">Configuration Notice</p>
            <p>Changes are written directly to the <code>.env</code> file. Core services (ARI, Rust RTP, PBX connection) may require a full server restart to apply structural changes. Always verify hardware availability before switching assistant modes.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Backup & Restore -->
    <section class="space-y-4 pt-2">
      <div class="flex items-center justify-between px-2 pb-2 border-b border-(--ui-border)">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-archive" class="size-4 text-primary" />
          <h2 class="text-sm font-bold uppercase tracking-wider text-muted-foreground">Backup & Restore</h2>
        </div>
      </div>

      <UCard class="shadow-sm">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-(--ui-text-highlighted)">Configuration Backup</p>
            <p class="text-xs text-(--ui-text-dimmed) mt-0.5">
              Export or restore environment variables, routing rules, assistant configs, and contact lists.
            </p>
          </div>
          <div class="flex items-center gap-2">
            <UButton
              label="Export"
              icon="i-lucide-download"
              color="primary"
              variant="soft"
              size="sm"
              :loading="backupExporting"
              @click="exportBackup"
            />
            <UButton
              label="Import"
              icon="i-lucide-upload"
              color="neutral"
              variant="soft"
              size="sm"
              @click="triggerImport"
            />
            <input
              ref="importInput"
              type="file"
              accept=".zip"
              class="hidden"
              @change="handleImportFile"
            />
          </div>
        </div>
      </UCard>

      <!-- Import Preview Modal -->
      <UModal v-model:open="previewOpen">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-file-diff" class="size-5 text-primary" />
            <span class="font-bold text-(--ui-text-highlighted)">Import Preview</span>
          </div>
        </template>
        <template #body>
          <div class="space-y-4">
            <!-- Meta -->
            <div v-if="previewMeta.timestamp" class="flex items-center gap-4 text-xs text-(--ui-text-dimmed)">
              <span>Backup from <strong>{{ new Date(previewMeta.timestamp).toLocaleString() }}</strong></span>
              <span v-if="previewMeta.hostname">Host: <strong>{{ previewMeta.hostname }}</strong></span>
            </div>

            <!-- Loading -->
            <div v-if="previewLoading" class="py-8 text-center">
              <UIcon name="i-lucide-loader-2" class="size-6 text-(--ui-text-dimmed) mx-auto mb-2 animate-spin" />
              <p class="text-sm text-(--ui-text-muted)">Analyzing backup...</p>
            </div>

            <!-- Changes list -->
            <div v-else class="space-y-2">
              <div
                v-for="change in previewChanges"
                :key="change.file"
                class="rounded-lg border border-(--ui-border) overflow-hidden"
              >
                <div
                  class="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-(--ui-bg-elevated)/50"
                  @click="togglePreviewExpand(change.file)"
                >
                  <UCheckbox
                    v-if="change.status !== 'unchanged' && change.status !== 'removed'"
                    :model-value="importSelections.includes(change.file)"
                    @update:model-value="toggleSelection(change.file)"
                    @click.stop
                  />
                  <span class="text-sm font-medium text-(--ui-text-highlighted) flex-1">{{ change.label }}</span>
                  <UBadge
                    :label="change.status"
                    :color="changeColor(change.status)"
                    variant="subtle"
                    size="xs"
                  />
                  <UIcon
                    v-if="change.diff.length > 0"
                    :name="previewExpanded === change.file ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                    class="size-4 text-(--ui-text-dimmed)"
                  />
                </div>

                <!-- Expanded diff -->
                <div v-if="previewExpanded === change.file && change.diff.length > 0" class="border-t border-(--ui-border) bg-(--ui-bg) px-3 py-2 max-h-48 overflow-y-auto">
                  <table class="w-full text-xs font-mono">
                    <thead>
                      <tr class="text-(--ui-text-dimmed)">
                        <th class="text-left py-1 pr-3 font-medium">Key</th>
                        <th class="text-left py-1 pr-3 font-medium">Current</th>
                        <th class="text-left py-1 font-medium">Backup</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="d in change.diff" :key="d.key" class="border-t border-(--ui-border)/50">
                        <td class="py-1 pr-3 text-(--ui-text-muted) whitespace-nowrap">{{ d.key }}</td>
                        <td class="py-1 pr-3 text-(--ui-error) break-all">{{ formatDiffValue(d.current) }}</td>
                        <td class="py-1 text-(--ui-success) break-all">{{ formatDiffValue(d.backup) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <p v-if="previewChanges.length === 0" class="text-sm text-(--ui-text-dimmed) text-center py-4">
                No files found in backup
              </p>
            </div>
          </div>
        </template>
        <template #footer>
          <div class="flex items-center justify-between w-full">
            <span class="text-xs text-(--ui-text-dimmed)">{{ importSelections.length }} file(s) selected</span>
            <div class="flex gap-2">
              <UButton label="Cancel" color="neutral" variant="ghost" size="sm" @click="previewOpen = false" />
              <UButton
                label="Apply Selected"
                icon="i-lucide-check"
                color="primary"
                size="sm"
                :loading="importing"
                :disabled="importSelections.length === 0"
                @click="applyImport"
              />
            </div>
          </div>
        </template>
      </UModal>
    </section>
  </div>
</template>

<script setup lang="ts">
const { serverConfig, emit } = useSocket();

// --- Assistant Mode ---
const assistant = ref("ivr-transfer");
const assistantOptions = ref<{ label: string; value: string }[]>([]);

async function fetchAssistants() {
  try {
    const data = await $fetch<{ assistants: any[] }>("/api/assistants");
    const all = data.assistants || [];
    assistantOptions.value = all
      .filter((a) => !a.config?.mode || a.config.mode === "incoming")
      .map((a) => ({
        label: a.config?.name || a.slug,
        value: a.slug,
      }));
    // All assistants for routing (including outbound)
    allAssistantOptions.value = all.map((a) => ({
      label: a.config?.name || a.slug,
      value: a.slug,
    }));
  } catch (e) {
    console.error("Failed to fetch assistants:", e);
    assistantOptions.value = [
      { label: "IVR Transfer", value: "ivr-transfer" },
      { label: "Direct Dial", value: "direct-dial" },
    ];
    allAssistantOptions.value = assistantOptions.value;
  }
}

const transcriptionServices = computed(() => {
  const raw = serverConfig.value?.transcriptionServices || "";
  if (!raw) return [];
  return raw.split(",").map((s: string) => s.trim()).filter(Boolean);
});

watch(
  () => serverConfig.value?.assistant,
  (val) => {
    if (val) assistant.value = val;
  },
  { immediate: true }
);

function updateAssistant() {
  emit("dashboard:setAssistant", { assistant: assistant.value });
}

// --- Routing Rules (unified flat list) ---
interface RoutingRule { type: "extension" | "callerId"; pattern: string; assistant: string }

const allRoutingRules = reactive<RoutingRule[]>([]);
const routingSaving = ref(false);
const routingMessage = ref("");
const routingError = ref(false);

// All assistants (incoming + outbound) for routing selects
const allAssistantOptions = ref<{ label: string; value: string }[]>([]);

async function fetchRouting() {
  try {
    const data = await $fetch<{ extensionRoutes?: any[]; callerIdRoutes?: any[] }>("/api/routing");
    allRoutingRules.length = 0;
    for (const r of data.extensionRoutes || []) {
      allRoutingRules.push({ type: "extension", pattern: r.pattern, assistant: r.assistant });
    }
    for (const r of data.callerIdRoutes || []) {
      allRoutingRules.push({ type: "callerId", pattern: r.pattern, assistant: r.assistant });
    }
  } catch (e) {
    console.error("Failed to fetch routing:", e);
  }
}

async function saveRouting() {
  routingSaving.value = true;
  routingMessage.value = "";
  routingError.value = false;

  try {
    const valid = allRoutingRules.filter(r => r.pattern && r.assistant);
    const payload = {
      defaultAssistant: assistant.value,
      extensionRoutes: valid.filter(r => r.type === "extension").map(({ pattern, assistant }) => ({ pattern, assistant })),
      callerIdRoutes: valid.filter(r => r.type === "callerId").map(({ pattern, assistant }) => ({ pattern, assistant })),
    };
    await $fetch("/api/routing", { method: "PUT", body: payload });
    routingMessage.value = "Saved";
    setTimeout(() => { routingMessage.value = ""; }, 3000);
  } catch (e: any) {
    routingError.value = true;
    routingMessage.value = e.data?.message || "Failed to save";
  } finally {
    routingSaving.value = false;
  }
}

// --- Env Configurator ---
interface EnvVar {
  key: string;
  label: string;
  sensitive: boolean;
  value: string;
}

interface EnvGroup {
  group: string;
  icon: string;
  vars: EnvVar[];
}

const envGroups = ref<EnvGroup[]>([]);
const envValues = ref<Record<string, string>>({});
const envSaving = ref(false);
const envMessage = ref("");
const envError = ref(false);
const revealed = ref<Record<string, boolean>>({});

function toggleReveal(key: string) {
  revealed.value = { ...revealed.value, [key]: !revealed.value[key] };
}

async function fetchEnv() {
  try {
    const data = await $fetch<{ groups: EnvGroup[] }>("/api/env");
    envGroups.value = data.groups;

    // Populate editable values
    const vals: Record<string, string> = {};
    for (const group of data.groups) {
      for (const v of group.vars) {
        vals[v.key] = v.value;
      }
    }
    envValues.value = vals;
  } catch (e) {
    console.error("Failed to fetch env:", e);
  }
}

async function saveEnv() {
  envSaving.value = true;
  envMessage.value = "";
  envError.value = false;

  try {
    await $fetch("/api/env", {
      method: "PUT",
      body: { vars: envValues.value },
    });
    envMessage.value = "Saved";
    setTimeout(() => { envMessage.value = ""; }, 3000);
  } catch (e: any) {
    envError.value = true;
    envMessage.value = e.data?.message || "Failed to save";
  } finally {
    envSaving.value = false;
  }
}

// --- Backup & Restore ---
interface DiffEntry { key: string; current: any; backup: any }
interface FileChange { file: string; label: string; status: string; diff: DiffEntry[] }

const backupExporting = ref(false);
const importInput = ref<HTMLInputElement | null>(null);
const previewOpen = ref(false);
const previewLoading = ref(false);
const previewMeta = ref<{ timestamp: string; hostname: string }>({ timestamp: "", hostname: "" });
const previewChanges = ref<FileChange[]>([]);
const previewExpanded = ref<string | null>(null);
const importSelections = ref<string[]>([]);
const importing = ref(false);
let importFile: File | null = null;

async function exportBackup() {
  backupExporting.value = true;
  try {
    const res = await fetch("/api/backup/export");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] || "backup.zip";
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("Export failed:", e);
  } finally {
    backupExporting.value = false;
  }
}

function triggerImport() {
  importInput.value?.click();
}

async function handleImportFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  input.value = ""; // Reset so same file can be re-selected

  importFile = file;
  previewOpen.value = true;
  previewLoading.value = true;
  previewChanges.value = [];
  previewMeta.value = { timestamp: "", hostname: "" };
  previewExpanded.value = null;
  importSelections.value = [];

  try {
    const form = new FormData();
    form.append("file", file);
    const data = await $fetch<{ meta: any; changes: FileChange[] }>("/api/backup/preview", {
      method: "POST",
      body: form,
    });
    previewMeta.value = data.meta;
    previewChanges.value = data.changes;
    // Pre-select modified and added files
    importSelections.value = data.changes
      .filter((c) => c.status === "modified" || c.status === "added")
      .map((c) => c.file);
  } catch (e) {
    console.error("Preview failed:", e);
  } finally {
    previewLoading.value = false;
  }
}

function toggleSelection(file: string) {
  const idx = importSelections.value.indexOf(file);
  if (idx >= 0) {
    importSelections.value.splice(idx, 1);
  } else {
    importSelections.value.push(file);
  }
}

function togglePreviewExpand(file: string) {
  previewExpanded.value = previewExpanded.value === file ? null : file;
}

function changeColor(status: string): "success" | "error" | "warning" | "neutral" {
  if (status === "modified") return "warning";
  if (status === "added") return "success";
  if (status === "removed") return "error";
  return "neutral";
}

function formatDiffValue(val: any): string {
  if (val === null || val === undefined) return "\u2014";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

async function applyImport() {
  if (!importFile || importSelections.value.length === 0) return;
  importing.value = true;

  try {
    const form = new FormData();
    form.append("file", importFile);
    form.append("selections", JSON.stringify(importSelections.value));
    const data = await $fetch<{ success: boolean; applied: string[]; errors: any[] }>("/api/backup/import", {
      method: "POST",
      body: form,
    });

    previewOpen.value = false;
    importFile = null;

    // Refresh all data after import
    fetchEnv();
    fetchRouting();
    fetchAssistants();

    envMessage.value = `Restored ${data.applied.length} file(s)`;
    envError.value = data.errors?.length > 0;
    setTimeout(() => { envMessage.value = ""; }, 4000);
  } catch (e: any) {
    console.error("Import failed:", e);
    envError.value = true;
    envMessage.value = "Import failed";
    setTimeout(() => { envMessage.value = ""; }, 4000);
  } finally {
    importing.value = false;
  }
}

onMounted(() => {
  fetchAssistants();
  fetchRouting();
  fetchEnv();
});
</script>

<style scoped>
.env-masonry {
  columns: 1;
  column-gap: 1.5rem;
}
@media (min-width: 1024px) {
  .env-masonry {
    columns: 2;
  }
}
.env-card {
  break-inside: avoid;
  margin-bottom: 1.5rem;
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease, transform 0.2s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
