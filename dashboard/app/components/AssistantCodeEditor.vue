<template>
  <div class="flex flex-col h-full">
    <!-- File tabs + Save/Diff buttons -->
    <div class="flex items-center gap-2 px-2 py-1.5 border-b border-(--ui-border) shrink-0">
      <template v-if="!diffMode">
        <UButton
          v-for="tab in fileTabs"
          :key="tab.key"
          :label="tab.label"
          :variant="activeFile === tab.key ? 'solid' : 'ghost'"
          :color="activeFile === tab.key ? 'primary' : 'neutral'"
          size="xs"
          @click="switchFile(tab.key)"
        />
        <div class="flex-1" />
        <span v-if="dirty" class="text-xs text-(--ui-warning)">Unsaved changes</span>
        <UButton
          v-if="activeFile === 'main'"
          label="Save"
          icon="i-lucide-save"
          color="primary"
          variant="soft"
          size="xs"
          :loading="saving"
          :disabled="!dirty"
          @click="saveCode"
        />
      </template>

      <!-- Diff mode header -->
      <template v-else>
        <UIcon name="i-lucide-git-compare" class="size-4 text-(--ui-primary)" />
        <span class="text-xs font-medium text-(--ui-text-highlighted)">Review AI Changes</span>
        <div class="flex-1" />
        <UButton
          label="Reject"
          icon="i-lucide-x"
          color="error"
          variant="soft"
          size="xs"
          @click="rejectDiff"
        />
        <UButton
          label="Accept"
          icon="i-lucide-check"
          color="success"
          variant="soft"
          size="xs"
          @click="acceptDiff"
        />
      </template>
    </div>

    <!-- Editor container — fills remaining space -->
    <div ref="editorContainer" class="flex-1 min-h-0" />

    <!-- Status message -->
    <div v-if="message" class="flex items-center gap-2 px-2 py-1 shrink-0 border-t border-(--ui-border)">
      <UIcon
        :name="messageError ? 'i-lucide-alert-circle' : 'i-lucide-check-circle'"
        :class="messageError ? 'text-(--ui-error)' : 'text-(--ui-success)'"
        class="size-3.5"
      />
      <span class="text-xs" :class="messageError ? 'text-(--ui-error)' : 'text-(--ui-success)'">
        {{ message }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { registerCompletion } from "monacopilot";

const props = defineProps<{ slug: string }>();

const { $monaco } = useNuxtApp();
const colorMode = useColorMode();

const editorContainer = ref<HTMLElement | null>(null);
const saving = ref(false);
const message = ref("");
const messageError = ref(false);
const dirty = ref(false);
const activeFile = ref<"main" | "base" | "types">("main");
const diffMode = ref(false);

// Code storage
const mainCode = ref("");
const baseCode = ref("");
const typesCode = ref("");
const savedCode = ref(""); // Track saved state for dirty detection
const fileName = ref("");

// Diff state
const diffOriginal = ref("");
const diffProposed = ref("");

let editor: any = null;
let diffEditor: any = null;
let completionRegistration: any = null;

const fileTabs = computed(() => [
  { key: "main" as const, label: fileName.value || "Assistant.ts" },
  { key: "base" as const, label: "BaseAssistant.ts" },
  { key: "types" as const, label: "AssistantTypes.ts" },
]);

async function fetchCode() {
  try {
    const data = await $fetch<{
      slug: string;
      fileName: string;
      code: string;
      baseCode: string | null;
      typesCode: string | null;
    }>(`/api/assistants/${props.slug}/code`);

    mainCode.value = data.code;
    savedCode.value = data.code;
    baseCode.value = data.baseCode || "// BaseAssistant.ts not found";
    typesCode.value = data.typesCode || "// AssistantTypes.ts not found";
    fileName.value = data.fileName;
    dirty.value = false;

    updateEditorContent();
  } catch (e: any) {
    message.value = e.data?.message || "Failed to load code";
    messageError.value = true;
  }
}

function updateEditorContent() {
  if (!editor) return;

  const code =
    activeFile.value === "main"
      ? mainCode.value
      : activeFile.value === "base"
        ? baseCode.value
        : typesCode.value;

  const isReadOnly = activeFile.value !== "main";
  editor.setValue(code);
  editor.updateOptions({ readOnly: isReadOnly });
}

function switchFile(key: "main" | "base" | "types") {
  // Save current main code before switching
  if (activeFile.value === "main" && editor) {
    mainCode.value = editor.getValue();
  }
  activeFile.value = key;
  updateEditorContent();
}

async function saveCode() {
  if (!editor || activeFile.value !== "main") return;

  saving.value = true;
  message.value = "";
  messageError.value = false;

  const code = editor.getValue();

  try {
    await $fetch(`/api/assistants/${props.slug}/code`, {
      method: "PUT",
      body: { code },
    });

    mainCode.value = code;
    savedCode.value = code;
    dirty.value = false;
    message.value = "Code saved";
    messageError.value = false;
  } catch (e: any) {
    message.value = e.data?.message || "Failed to save";
    messageError.value = true;
  } finally {
    saving.value = false;
  }
}

// --- Diff editor ---

function showDiff(proposedCode: string) {
  if (!$monaco || !editorContainer.value) return;
  const monaco = $monaco as any;

  // Save current code as the original
  if (editor) {
    if (activeFile.value === "main") {
      mainCode.value = editor.getValue();
    }
    diffOriginal.value = mainCode.value;
  } else {
    diffOriginal.value = mainCode.value;
  }
  diffProposed.value = proposedCode;

  // Clean up whatever editor is currently showing
  if (diffEditor) {
    destroyDiffEditor();
  }
  if (editor) {
    destroyEditor();
  } else {
    clearContainer();
  }

  // Create inline diff editor
  diffEditor = monaco.editor.createDiffEditor(editorContainer.value, {
    theme: colorMode.value === "dark" ? "vs-dark" : "vs",
    automaticLayout: true,
    readOnly: true,
    renderSideBySide: false,    // inline diff (not side-by-side)
    minimap: { enabled: false },
    fontSize: 13,
    lineNumbers: "on",
    scrollBeyondLastLine: false,
    wordWrap: "on",
    renderWhitespace: "selection",
    enableSplitViewResizing: false,
    renderIndicators: true,
    renderMarginRevertIcon: false,
  });

  const originalModel = monaco.editor.createModel(diffOriginal.value, "typescript");
  const modifiedModel = monaco.editor.createModel(diffProposed.value, "typescript");

  diffEditor.setModel({
    original: originalModel,
    modified: modifiedModel,
  });

  diffMode.value = true;
  // Switch to main file tab context
  activeFile.value = "main";
}

function acceptDiff() {
  // Apply proposed code BEFORE recreating editor
  mainCode.value = diffProposed.value;
  dirty.value = mainCode.value !== savedCode.value;

  exitDiffMode();
  // exitDiffMode → destroyDiffEditor → initEditor (uses mainCode.value) → updateEditorContent

  message.value = "Changes applied";
  messageError.value = false;
}

function rejectDiff() {
  exitDiffMode();

  message.value = "Changes rejected";
  messageError.value = false;
}

function exitDiffMode() {
  destroyDiffEditor();
  diffMode.value = false;
  diffOriginal.value = "";
  diffProposed.value = "";

  // Recreate normal editor
  initEditor();
  updateEditorContent();
}

function clearContainer() {
  if (editorContainer.value) {
    editorContainer.value.innerHTML = "";
  }
}

function destroyEditor() {
  if (completionRegistration) {
    completionRegistration.deregister();
    completionRegistration = null;
  }
  if (editor) {
    editor.dispose();
    editor = null;
  }
  clearContainer();
}

function destroyDiffEditor() {
  if (diffEditor) {
    // Save model refs before disposing editor
    const model = diffEditor.getModel();
    // Dispose editor FIRST (it references the models)
    diffEditor.dispose();
    diffEditor = null;
    // Then dispose orphaned models
    if (model) {
      model.original?.dispose();
      model.modified?.dispose();
    }
  }
  clearContainer();
}

function initEditor() {
  if (!editorContainer.value || !$monaco) return;

  const monaco = $monaco as any;

  editor = monaco.editor.create(editorContainer.value, {
    value: mainCode.value,
    language: "typescript",
    theme: colorMode.value === "dark" ? "vs-dark" : "vs",
    minimap: { enabled: false },
    fontSize: 13,
    lineNumbers: "on",
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 2,
    wordWrap: "on",
    renderWhitespace: "selection",
  });

  // Track changes for dirty state
  editor.onDidChangeModelContent(() => {
    if (activeFile.value === "main") {
      mainCode.value = editor.getValue();
      dirty.value = mainCode.value !== savedCode.value;
    }
  });

  // Ctrl+S to save
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    if (activeFile.value === "main" && dirty.value) {
      saveCode();
    }
  });

  // AI completions via monacopilot
  completionRegistration = registerCompletion(monaco, editor, {
    language: "typescript",
    endpoint: "/api/code-completion",
    trigger: "onIdle",
    filename: fileName.value || "Assistant.ts",
    technologies: ["typescript", "node.js", "asterisk-ari"],
    relatedFiles: [
      { path: "./BaseAssistant.ts", content: baseCode.value },
      { path: "./AssistantTypes.ts", content: typesCode.value },
    ],
  });
}

// Watch theme changes
watch(
  () => colorMode.value,
  (mode) => {
    if (!$monaco) return;
    const monaco = $monaco as any;
    monaco.editor.setTheme(mode === "dark" ? "vs-dark" : "vs");
  }
);

// Direct apply: sets code immediately without diff view
function applyDirectly(code: string) {
  if (!code) return;

  // If currently showing a diff, tear it down first
  if (diffMode.value) {
    destroyDiffEditor();
    diffMode.value = false;
    diffOriginal.value = "";
    diffProposed.value = "";
  }

  mainCode.value = code;
  dirty.value = mainCode.value !== savedCode.value;
  activeFile.value = "main";

  if (!editor) {
    initEditor();
  } else {
    editor.setValue(code);
  }

  message.value = "Code applied";
  messageError.value = false;
}

// Expose for parent (chat panel needs current code + diff trigger)
defineExpose({
  getCode: () => editor ? editor.getValue() : mainCode.value,
  getFileName: () => fileName.value,
  setCode: (code: string) => {
    if (editor && activeFile.value === "main") {
      editor.setValue(code);
    }
  },
  showDiff,
  applyDirectly,
});

// Watch slug changes
watch(
  () => props.slug,
  () => {
    if (diffMode.value) exitDiffMode();
    activeFile.value = "main";
    message.value = "";
    fetchCode();
  }
);

onMounted(async () => {
  await fetchCode();
  await nextTick();
  initEditor();
});

onBeforeUnmount(() => {
  destroyEditor();
  destroyDiffEditor();
});
</script>
