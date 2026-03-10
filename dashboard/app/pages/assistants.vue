<template>
  <div class="h-[calc(100vh-6rem)] flex flex-col">
    <!-- Top bar -->
    <div class="flex items-center gap-3 mb-4 shrink-0">
      <div>
        <h1 class="text-2xl font-bold text-(--ui-text-highlighted)">Assistants</h1>
        <p class="text-xs text-(--ui-text-dimmed)">Configure how each assistant behaves (prompts, timeouts, transfer logic)</p>
      </div>
      <div class="flex-1" />
      <UBadge
        :label="`${assistants.length} assistant${assistants.length !== 1 ? 's' : ''}`"
        color="neutral"
        variant="subtle"
        icon="i-lucide-bot"
      />
      <UButton
        label="New"
        icon="i-lucide-plus"
        color="primary"
        variant="soft"
        size="md"
        @click="showCreate = true"
      />
    </div>

    <!-- Main content -->
    <div class="flex-1 flex gap-4 min-h-0">
      <!-- Left sidebar: Assistant list -->
      <nav class="w-56 shrink-0 overflow-y-auto pr-3 space-y-1">
        <button
          v-for="a in assistants"
          :key="a.slug"
          class="sidebar-item w-full text-left flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all duration-150"
          :class="selected?.slug === a.slug ? 'sidebar-item--active' : ''"
          @click="selectAssistant(a.slug)"
        >
          <UIcon :name="assistantIcon(a.slug)" class="size-4 shrink-0" :class="selected?.slug === a.slug ? 'text-(--ui-primary)' : 'text-(--ui-text-muted)'" />
          <div class="flex-1 min-w-0">
            <p class="truncate font-medium" :class="selected?.slug === a.slug ? 'text-(--ui-primary)' : 'text-(--ui-text) hover:text-(--ui-text-highlighted)'">
              {{ a.config?.name || a.slug }}
            </p>
            <div class="flex items-center gap-1.5 mt-0.5">
              <span class="text-[10px] text-(--ui-text-dimmed) font-mono">{{ a.slug }}</span>
              <UBadge
                :label="a.brain === 'flow' ? 'FLOW' : a.brain ? 'PRESET' : 'CODE'"
                :color="a.brain === 'flow' ? 'warning' : a.brain ? 'info' : 'success'"
                variant="subtle"
                size="xs"
              />
              <UBadge
                v-if="a.config?.mode === 'outbound'"
                label="OUT"
                color="warning"
                variant="subtle"
                size="xs"
              />
            </div>
          </div>
        </button>
      </nav>

      <!-- Right: Editor area -->
      <div class="flex-1 min-w-0 flex flex-col">
        <!-- Empty state -->
        <div v-if="!selected" class="flex-1 flex items-center justify-center rounded-xl border border-dashed border-(--ui-border-accented)">
          <div class="text-center">
            <UIcon name="i-lucide-mouse-pointer-click" class="size-10 text-(--ui-text-dimmed) mx-auto mb-3" />
            <p class="text-sm text-(--ui-text-muted)">Select an assistant to edit</p>
          </div>
        </div>

        <!-- Editor -->
        <template v-else>
          <!-- Header bar -->
          <div class="header-bar flex items-center gap-2 mb-3 px-3 py-2 rounded-lg shrink-0">
            <UIcon :name="assistantIcon(selected.slug)" class="size-5 text-(--ui-primary)" />
            <span class="font-semibold text-(--ui-text-highlighted)">{{ selected.config?.name }}</span>
            <UBadge :label="selected.slug" color="neutral" variant="subtle" size="xs" class="font-mono" />
            <UButton
              icon="i-lucide-folder-open"
              color="neutral"
              variant="ghost"
              size="xs"
              :title="selectedDir || `assistants/${selected.slug}`"
              @click="copyPath(selected.slug)"
            />
            <transition name="fade">
              <span v-if="pathCopied" class="text-[10px] text-(--ui-success) font-medium">Copied!</span>
            </transition>

            <div class="flex-1" />

            <!-- Context actions per tab -->
            <template v-if="activeTab === 'settings'">
              <div class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-(--ui-bg)/60 border border-(--ui-border)">
                <span class="text-[10px] font-bold tracking-wider uppercase text-(--ui-text-dimmed)">JSON</span>
                <USwitch v-model="rawMode" size="sm" />
              </div>
              <transition name="fade">
                <span v-if="saveMessage" class="text-xs font-medium" :class="saveError ? 'text-(--ui-error)' : 'text-(--ui-success)'">
                  <UIcon :name="saveError ? 'i-lucide-alert-circle' : 'i-lucide-check-circle'" class="size-3.5 inline-block align-[-3px] mr-1" />
                  {{ saveMessage }}
                </span>
              </transition>
              <UButton icon="i-lucide-save" label="Save" color="primary" size="xs" :loading="saving" :disabled="rawMode && !!rawJsonError" @click="saveConfig" />
            </template>

            <template v-if="activeTab === 'prompt'">
              <transition name="fade">
                <span v-if="saveMessage" class="text-xs font-medium" :class="saveError ? 'text-(--ui-error)' : 'text-(--ui-success)'">
                  <UIcon :name="saveError ? 'i-lucide-alert-circle' : 'i-lucide-check-circle'" class="size-3.5 inline-block align-[-3px] mr-1" />
                  {{ saveMessage }}
                </span>
              </transition>
              <UButton icon="i-lucide-save" label="Save" color="primary" size="xs" :loading="promptEditorRef?.saving" @click="promptEditorRef?.save()" />
            </template>

            <template v-if="activeTab === 'flow'">
              <transition name="fade">
                <span v-if="saveMessage" class="text-xs font-medium" :class="saveError ? 'text-(--ui-error)' : 'text-(--ui-success)'">
                  <UIcon :name="saveError ? 'i-lucide-alert-circle' : 'i-lucide-check-circle'" class="size-3.5 inline-block align-[-3px] mr-1" />
                  {{ saveMessage }}
                </span>
              </transition>
              <!-- Visual flow builder actions -->
              <template v-if="selected?.brain === 'flow'">
                <UButton icon="i-lucide-save" label="Save Flow" color="primary" size="xs" :loading="flowBuilderRef?.saving" @click="flowBuilderRef?.saveFlow()" />
              </template>
              <!-- Mermaid flow actions -->
              <template v-else>
                <UButton icon="i-lucide-sparkles" label="Generate" color="neutral" variant="soft" size="xs" :loading="generatingFlow" @click="generateFlow" />
                <UButton v-if="editConfig.flow" :icon="flowEditMode ? 'i-lucide-eye' : 'i-lucide-pencil'" :label="flowEditMode ? 'Preview' : 'Edit'" color="neutral" variant="ghost" size="xs" @click="flowEditMode = !flowEditMode" />
                <UButton icon="i-lucide-save" label="Save" color="primary" size="xs" :loading="saving" :disabled="!flowDirty" @click="saveConfig" />
              </template>
            </template>

            <!-- Tab switcher -->
            <div class="w-px h-5 bg-(--ui-border)" />
            <div class="tab-switcher flex items-center rounded-lg p-0.5">
              <button
                v-for="tab in [
                  { id: 'flow', icon: 'i-lucide-git-branch', label: 'Flow' },
                  { id: 'settings', icon: 'i-lucide-sliders-horizontal', label: 'Config' },
                  ...(selected?.brain !== 'flow' ? [{ id: 'prompt', icon: 'i-lucide-layers', label: 'Prompt' }] : []),
                  ...(selected?.brain !== 'flow' ? [{ id: 'code', icon: 'i-lucide-code', label: 'Code' }] : []),
                ]"
                :key="tab.id"
                class="px-2.5 py-1 text-xs font-medium rounded-md transition-all"
                :class="activeTab === tab.id
                  ? 'tab-active'
                  : 'text-(--ui-text-muted) hover:text-(--ui-text)'"
                @click="activeTab = tab.id as any"
              >
                <UIcon :name="tab.icon" class="size-3.5 mr-1 inline-block align-[-2px]" />
                {{ tab.label }}
              </button>
            </div>

            <UButton
              v-if="!isBuiltIn(selected.slug)"
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="xs"
              @click="confirmDelete"
            />
          </div>

          <!-- Config Tab -->
          <div v-if="activeTab === 'settings'" class="flex-1 overflow-y-auto">
            <div class="px-1 space-y-4 pb-10">
              <!-- Raw JSON mode -->
              <div v-if="rawMode" class="space-y-2">
                <div v-if="rawJsonError" class="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--ui-error)/10 text-(--ui-error) text-xs">
                  <UIcon name="i-lucide-alert-circle" class="size-3.5 shrink-0" />
                  <span class="font-mono">{{ rawJsonError }}</span>
                </div>
                <div class="rounded-xl border overflow-hidden" :class="rawJsonError ? 'border-(--ui-error)' : 'border-(--ui-border)'">
                  <textarea
                    v-model="rawJson"
                    class="w-full min-h-[32rem] font-mono text-sm p-6 bg-(--ui-bg) text-(--ui-text) resize-none focus:outline-none"
                    spellcheck="false"
                    @input="rawJsonError = ''"
                  />
                </div>
              </div>

              <!-- Form mode -->
              <AssistantConfigForm
                v-else
                v-model="editConfig"
                :brain="editConfig.brain || null"
                :slug="selected?.slug || ''"
                :available-brains="availableBrains"
              />
            </div>
          </div>

          <!-- Flow Tab -->
          <div v-if="activeTab === 'flow'" class="flex-1 flex flex-col min-h-0">
            <!-- Visual Flow Builder for flow brains -->
            <template v-if="selected?.brain === 'flow'">
              <AssistantFlowBuilder ref="flowBuilderRef" :slug="selected.slug" />
            </template>

            <!-- Mermaid preview for other brains -->
            <template v-else>
              <div class="flex-1 min-h-0 flex gap-4">
                <div class="flex-1 min-w-0 rounded-xl border border-(--ui-border) bg-(--ui-bg) overflow-auto p-6">
                  <template v-if="editConfig.flow">
                    <ChatMermaidBlock :code="editConfig.flow" />
                  </template>
                  <div v-else class="h-full flex items-center justify-center">
                    <div class="text-center">
                      <UIcon name="i-lucide-workflow" class="size-12 text-(--ui-text-dimmed) mx-auto mb-3" />
                      <p class="text-sm text-(--ui-text-muted) mb-1">No flow diagram defined yet</p>
                      <p class="text-xs text-(--ui-text-dimmed) mb-4">Add a Mermaid flowchart to visualize this assistant's call logic</p>
                      <UButton
                        label="Add Flow Diagram"
                        icon="i-lucide-plus"
                        color="primary"
                        variant="soft"
                        size="sm"
                        @click="editConfig.flow = 'flowchart TD\n    A([Start]) --> B[Step 1]\n    B --> C{Decision}\n    C -->|Yes| D([End])\n    C -->|No| B'; flowEditMode = true"
                      />
                    </div>
                  </div>
                </div>

                <div v-if="flowEditMode && editConfig.flow" class="w-[400px] shrink-0 flex flex-col rounded-xl border border-(--ui-border) overflow-hidden">
                  <div class="flex items-center gap-2 px-3 py-2 bg-(--ui-bg-elevated) border-b border-(--ui-border)">
                    <UIcon name="i-lucide-file-code" class="size-3.5 text-(--ui-text-dimmed)" />
                    <span class="text-xs font-semibold text-(--ui-text-dimmed) uppercase tracking-wider">Mermaid Source</span>
                  </div>
                  <textarea
                    v-model="editConfig.flow"
                    class="flex-1 font-mono text-sm p-4 bg-(--ui-bg) text-(--ui-text) resize-none focus:outline-none"
                    spellcheck="false"
                    placeholder="flowchart TD&#10;    A([Start]) --> B[Step]"
                  />
                </div>
              </div>
            </template>
          </div>

          <!-- Prompt Tab -->
          <div v-if="activeTab === 'prompt'" class="flex-1 overflow-y-auto">
            <AssistantPromptEditor ref="promptEditorRef" :slug="selected.slug" />
          </div>

          <!-- Code Tab -->
          <div v-if="activeTab === 'code'" class="flex-1 flex flex-col min-h-0 rounded-xl border border-(--ui-border) overflow-hidden">
            <!-- Preset banner -->
            <div v-if="selectedIsPreset" class="flex items-center gap-2 px-3 py-2 bg-(--ui-bg-elevated) border-b border-(--ui-border) shrink-0">
              <UIcon name="i-lucide-puzzle" class="size-4 text-(--ui-info)" />
              <span class="text-xs text-(--ui-text-muted)">
                This assistant uses the <strong class="text-(--ui-text-highlighted)">{{ selected.brain }}</strong> preset. Code is read-only.
              </span>
              <UBadge label="PRESET" color="info" variant="subtle" size="xs" />
            </div>

            <div class="flex-1 flex min-h-0">
              <div class="flex-1 min-w-0 h-full">
                <AssistantCodeEditor ref="codeEditorRef" :slug="selected.slug" :read-only="selectedIsPreset" />
              </div>

              <template v-if="!selectedIsPreset">
                <button
                  class="w-7 shrink-0 flex items-center justify-center border-l border-(--ui-border) bg-(--ui-bg-elevated) hover:bg-(--ui-bg-elevated)/80 transition-colors"
                  @click="chatOpen = !chatOpen"
                >
                  <UIcon
                    :name="chatOpen ? 'i-lucide-panel-right-close' : 'i-lucide-sparkles'"
                    class="size-4"
                    :class="chatOpen ? 'text-(--ui-text-muted)' : 'text-(--ui-primary)'"
                  />
                </button>

                <template v-if="chatOpen">
                  <div
                    class="w-1 shrink-0 cursor-col-resize bg-(--ui-border) hover:bg-(--ui-primary)/40 active:bg-(--ui-primary)/60 transition-colors"
                    @mousedown="startResize"
                  />
                  <div class="shrink-0 h-full overflow-hidden" :style="{ width: chatWidth + 'px' }">
                    <AssistantCodeChat
                      :code-getter="() => codeEditorRef?.getCode?.() || ''"
                      :file-name-getter="() => codeEditorRef?.getFileName?.() || ''"
                      :slug="selected.slug"
                      @apply-code="applyCodeFromChat"
                      @apply-code-direct="applyCodeDirectFromChat"
                    />
                  </div>
                </template>
              </template>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Create modal -->
    <CreateAssistantModal
      v-model="showCreate"
      :templates="assistants"
      @created="onAssistantCreated"
    />

    <!-- Delete confirmation -->
    <UModal v-model:open="showDeleteConfirm">
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-alert-triangle" class="size-4 text-(--ui-error)" />
              <span class="font-semibold text-(--ui-text-highlighted)">Delete Assistant</span>
            </div>
          </template>

          <div class="space-y-3">
            <p class="text-sm text-(--ui-text-muted)">
              Are you sure you want to delete
              <strong class="text-(--ui-text-highlighted)">{{ selected?.config?.name }}</strong>
              ({{ selected?.slug }})? This will permanently remove the assistant folder and all its code.
            </p>

            <div v-if="deleteRoutingWarnings.length" class="flex gap-2 px-3 py-2.5 rounded-lg bg-(--ui-warning)/10 border border-(--ui-warning)/30">
              <UIcon name="i-lucide-alert-triangle" class="size-4 text-(--ui-warning) shrink-0 mt-0.5" />
              <div class="text-xs">
                <p class="font-semibold text-(--ui-warning) mb-1">This assistant is referenced in routing:</p>
                <ul class="list-disc pl-4 text-(--ui-text-muted) space-y-0.5">
                  <li v-for="w in deleteRoutingWarnings" :key="w">{{ w }}</li>
                </ul>
                <p class="text-(--ui-text-dimmed) mt-1">Routing rules referencing this assistant will break after deletion.</p>
              </div>
            </div>
          </div>

          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton label="Cancel" color="neutral" variant="ghost" @click="showDeleteConfirm = false" />
              <UButton
                :label="deleteRoutingWarnings.length ? 'Delete Anyway' : 'Delete'"
                icon="i-lucide-trash-2"
                color="error"
                :loading="deleting"
                @click="deleteAssistant"
              />
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
interface AssistantEntry {
  slug: string;
  config: any;
  hasCode: boolean;
  brain: string | null;
  error?: string;
}

const assistants = ref<AssistantEntry[]>([]);
const availableBrains = ref<{ slug: string; file: string }[]>([]);
const selected = ref<AssistantEntry | null>(null);
const selectedDir = ref("");
const editConfig = ref<any>({});
const rawJson = ref("");
const rawMode = ref(false);
const saving = ref(false);
const saveMessage = ref("");
const saveError = ref(false);
const activeTab = ref<"settings" | "flow" | "prompt" | "code">("flow");
const showCreate = ref(false);
const showDeleteConfirm = ref(false);
const deleting = ref(false);
const deleteRoutingWarnings = ref<string[]>([]);
const chatOpen = ref(true);
const chatWidth = ref(450);

const codeEditorRef = ref<any>(null);
const promptEditorRef = ref<any>(null);
const flowBuilderRef = ref<any>(null);
const flowEditMode = ref(false);
const flowOriginal = ref("");
const generatingFlow = ref(false);
const builtInSlugs = ["ivr-transfer", "direct-dial", "auto-dialer-call"];
const rawJsonError = ref("");

const selectedIsPreset = computed(() => !!selected.value?.brain);

const flowDirty = computed(() => {
  return (editConfig.value.flow || "") !== flowOriginal.value;
});

function isBuiltIn(slug: string): boolean {
  return builtInSlugs.includes(slug);
}

async function generateFlow() {
  if (!selected.value) return;
  generatingFlow.value = true;
  try {
    const data = await $fetch<{ flow: string }>(`/api/assistants/${selected.value.slug}/generate-flow`, {
      method: "POST",
    });
    if (data.flow) {
      editConfig.value.flow = data.flow;
    }
  } catch (e: any) {
    saveError.value = true;
    saveMessage.value = e.data?.message || "Failed to generate flow";
    setTimeout(() => { saveMessage.value = ""; }, 3000);
  } finally {
    generatingFlow.value = false;
  }
}

async function fetchAssistants() {
  try {
    const data = await $fetch<{ assistants: AssistantEntry[]; brains: { slug: string; file: string }[] }>("/api/assistants");
    assistants.value = data.assistants || [];
    availableBrains.value = data.brains || [];
  } catch (e) {
    console.error("Failed to fetch assistants:", e);
  }
}

async function selectAssistant(slug: string) {
  saveMessage.value = "";
  try {
    const data = await $fetch<{ slug: string; config: any; raw: string; dir: string; hasCode: boolean; brain: string | null }>(`/api/assistants/${slug}`);
    selected.value = { slug, config: data.config, hasCode: data.hasCode, brain: data.brain };
    selectedDir.value = data.dir || "";
    editConfig.value = JSON.parse(JSON.stringify(data.config));
    rawJson.value = JSON.stringify(data.config, null, 2);
    flowOriginal.value = data.config.flow || "";
  } catch (e) {
    console.error("Failed to fetch assistant:", e);
  }
}

async function validateMermaid(code: string): Promise<string | null> {
  try {
    const mm = await import("mermaid").then((m) => m.default);
    await mm.parse(code);
    return null;
  } catch (e: any) {
    return (e?.message || String(e)).replace(/\n?mermaid version[\s\S]*$/, "").trim() || "Invalid diagram syntax";
  }
}

async function saveConfig() {
  if (!selected.value) return;
  saving.value = true;
  saveMessage.value = "";
  saveError.value = false;

  // Validate Mermaid flow before saving
  if (editConfig.value.flow && flowDirty.value) {
    const mermaidErr = await validateMermaid(editConfig.value.flow);
    if (mermaidErr) {
      saving.value = false;
      saveError.value = true;
      saveMessage.value = `Invalid flow diagram: ${mermaidErr}`;
      return;
    }
  }

  try {
    const body = rawMode.value
      ? { raw: rawJson.value }
      : { config: editConfig.value };

    const data = await $fetch<{ success: boolean; config: any }>(`/api/assistants/${selected.value.slug}`, {
      method: "PUT",
      body,
    });

    editConfig.value = JSON.parse(JSON.stringify(data.config));
    rawJson.value = JSON.stringify(data.config, null, 2);
    flowOriginal.value = data.config.flow || "";
    const brain = data.config.brain || null;
    selected.value = { slug: selected.value.slug, config: data.config, hasCode: !brain && selected.value.hasCode, brain };
    saveMessage.value = "Saved successfully";
    await fetchAssistants();
  } catch (e: any) {
    saveError.value = true;
    saveMessage.value = e.data?.message || e.message || "Failed to save";
  } finally {
    saving.value = false;
  }
}

async function confirmDelete() {
  if (!selected.value) return;
  deleteRoutingWarnings.value = [];

  // Pre-check routing references
  try {
    const routing = await $fetch<{ extensionRoutes?: any[]; callerIdRoutes?: any[] }>("/api/routing");
    const slug = selected.value.slug;
    const warnings: string[] = [];
    for (const r of routing.extensionRoutes || []) {
      if (r.assistant === slug) warnings.push(`Extension route: ${r.pattern}`);
    }
    for (const r of routing.callerIdRoutes || []) {
      if (r.assistant === slug) warnings.push(`Caller ID route: ${r.pattern}`);
    }
    deleteRoutingWarnings.value = warnings;
  } catch { /* ignore — proceed without warning */ }

  showDeleteConfirm.value = true;
}

async function deleteAssistant() {
  if (!selected.value) return;
  deleting.value = true;

  try {
    await $fetch(`/api/assistants/${selected.value.slug}?force=true`, { method: "DELETE" });
    selected.value = null;
    showDeleteConfirm.value = false;
    await fetchAssistants();
  } catch (e: any) {
    console.error("Failed to delete:", e.data?.message || e.message);
  } finally {
    deleting.value = false;
  }
}

async function onAssistantCreated(slug: string) {
  await fetchAssistants();
  selectAssistant(slug);
}

function applyCodeFromChat(code: string) {
  if (!code || selected.value?.brain === 'flow') return;
  activeTab.value = "code";
  nextTick(() => {
    if (codeEditorRef.value?.showDiff) {
      codeEditorRef.value.showDiff(code);
    }
  });
}

function applyCodeDirectFromChat(code: string) {
  if (!code || selected.value?.brain === 'flow') return;
  activeTab.value = "code";
  nextTick(() => {
    if (codeEditorRef.value?.applyDirectly) {
      codeEditorRef.value.applyDirectly(code);
    }
  });
}

// Copy assistant folder path to clipboard
const pathCopied = ref(false);
async function copyPath(slug: string) {
  const path = selectedDir.value || `assistants/${slug}`;
  await navigator.clipboard.writeText(path);
  pathCopied.value = true;
  setTimeout(() => { pathCopied.value = false; }, 2000);
}

function assistantIcon(slug: string): string {
  const icons: Record<string, string> = {
    "ivr-transfer": "i-lucide-phone-forwarded",
    "direct-dial": "i-lucide-phone-call",
    "auto-dialer-call": "i-lucide-phone-outgoing",
  };
  return icons[slug] || "i-lucide-bot";
}

function startResize(e: MouseEvent) {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = chatWidth.value;

  function onMove(ev: MouseEvent) {
    const delta = startX - ev.clientX;
    chatWidth.value = Math.min(700, Math.max(250, startWidth + delta));
  }

  function onUp() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

watch(rawMode, (isRaw) => {
  rawJsonError.value = "";
  if (isRaw) {
    rawJson.value = JSON.stringify(editConfig.value, null, 2);
  } else {
    try {
      editConfig.value = JSON.parse(rawJson.value);
    } catch (e: any) {
      rawJsonError.value = e.message || "Invalid JSON";
      rawMode.value = true;
    }
  }
});

onMounted(() => {
  fetchAssistants();
  chatWidth.value = Math.min(700, Math.max(350, Math.round(window.innerWidth * 0.28)));
});
</script>

<style scoped>
/* Sidebar items */
.sidebar-item {
  border: 1px solid transparent;
}
.sidebar-item:hover {
  background-color: var(--ui-bg-elevated);
}
.sidebar-item--active {
  background-color: color-mix(in srgb, var(--ui-primary) 8%, transparent);
  border-color: color-mix(in srgb, var(--ui-primary) 25%, transparent);
}

/* Header bar */
.header-bar {
  background-color: var(--ui-bg-elevated);
  border: 1px solid var(--ui-border);
}

/* Tab switcher */
.tab-switcher {
  background-color: color-mix(in srgb, var(--ui-bg) 60%, transparent);
  border: 1px solid var(--ui-border);
}
.tab-active {
  background-color: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
  box-shadow: 0 1px 2px rgba(0,0,0,.06);
}

/* Transitions */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
