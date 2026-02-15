<template>
  <div class="flex flex-col h-full border-l border-(--ui-border)">
    <!-- Header -->
    <div class="flex items-center gap-1.5 px-3 py-2 border-b border-(--ui-border) shrink-0">
      <UIcon name="i-lucide-sparkles" class="size-4 text-(--ui-primary) shrink-0" />
      <span class="font-semibold text-sm text-(--ui-text-highlighted) shrink-0">AI</span>

      <!-- History dropdown -->
      <template v-if="aiConfigured">
        <UDropdownMenu v-if="chatHistoryList.length > 0" :items="historyMenuItems">
          <UButton
            :label="activeChatLabel"
            icon="i-lucide-chevron-down"
            trailing
            color="neutral"
            variant="ghost"
            size="xs"
            class="ml-1 max-w-[140px] truncate"
          />
        </UDropdownMenu>
      </template>

      <div class="flex-1" />

      <template v-if="aiConfigured">
        <UDropdownMenu :items="modelMenuItems">
          <UButton
            :label="selectedModelLabel"
            icon="i-lucide-cpu"
            color="neutral"
            variant="ghost"
            size="xs"
            class="max-w-[120px] truncate"
          />
        </UDropdownMenu>
        <UDropdownMenu :items="settingsMenuItems">
          <UButton
            icon="i-lucide-settings"
            color="neutral"
            variant="ghost"
            size="xs"
            title="Chat settings"
          />
        </UDropdownMenu>
        <UBadge
          v-if="chat?.status === 'streaming'"
          label="streaming"
          color="success"
          variant="subtle"
          size="xs"
        />
        <UButton
          icon="i-lucide-plus"
          color="neutral"
          variant="ghost"
          size="xs"
          title="New chat"
          @click="newChat"
        />
        <UButton
          icon="i-lucide-trash-2"
          color="neutral"
          variant="ghost"
          size="xs"
          title="Delete this chat"
          @click="deleteCurrentChat"
        />
      </template>
    </div>

    <!-- Not configured banner -->
    <div v-if="!aiConfigured && !loading" class="flex-1 flex flex-col items-center justify-center p-6 text-center">
      <UIcon name="i-lucide-key" class="size-10 text-(--ui-text-dimmed) mb-3" />
      <p class="font-semibold text-(--ui-text-highlighted) mb-1">AI Not Configured</p>
      <p class="text-sm text-(--ui-text-muted) mb-4">
        Add your Mistral API key to enable AI chat and inline code completions.
      </p>
      <div class="space-y-2 text-left w-full">
        <div class="text-xs text-(--ui-text-dimmed) space-y-1">
          <p>1. Get a free API key from <strong>console.mistral.ai</strong></p>
          <p>2. Go to <strong>Config</strong> page</p>
          <p>3. Find <strong>AI / Code Completion</strong> section</p>
          <p>4. Paste your <strong>MISTRAL_API_KEY</strong></p>
        </div>
      </div>
      <NuxtLink to="/config">
        <UButton
          label="Go to Config"
          icon="i-lucide-settings"
          color="primary"
          variant="soft"
          size="md"
          class="mt-4"
        />
      </NuxtLink>
    </div>

    <!-- Loading state -->
    <div v-else-if="loading" class="flex-1 flex items-center justify-center">
      <UIcon name="i-lucide-loader" class="size-6 animate-spin text-(--ui-text-dimmed)" />
    </div>

    <!-- Chat interface (when configured) -->
    <template v-else>
      <!-- Messages -->
      <div ref="messagesContainer" class="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        <div v-if="displayMessages.length === 0" class="text-center py-8">
          <UIcon name="i-lucide-message-circle" class="size-8 text-(--ui-text-dimmed) mx-auto mb-2" />
          <p class="text-sm text-(--ui-text-dimmed)">Ask about the code, request changes, or get explanations.</p>
          <div class="mt-4 space-y-1">
            <UButton
              v-for="q in quickPrompts"
              :key="q"
              :label="q"
              color="neutral"
              variant="ghost"
              size="xs"
              class="block w-full text-left"
              @click="sendQuick(q)"
            />
          </div>
        </div>

        <div
          v-for="msg in displayMessages"
          :key="msg.id"
          class="text-sm"
          :class="msg.role === 'user' ? 'ml-6' : 'mr-2'"
        >
          <!-- User message -->
          <div v-if="msg.role === 'user'" class="bg-(--ui-primary)/10 rounded-lg px-3 py-2 text-(--ui-text)">
            <template v-for="(part, j) in msg.parts" :key="j">
              <span v-if="part.type === 'text'">{{ part.text }}</span>
            </template>
          </div>

          <!-- Assistant message -->
          <div v-else class="space-y-2">
            <template v-for="(block, j) in parseMessageBlocks(msg)" :key="j">
              <!-- Text: rendered as markdown -->
              <div v-if="block.type === 'text'" class="chat-md text-(--ui-text-muted)" v-html="renderMarkdown(block.content)" />

              <!-- Markdown code block → rendered as formatted content -->
              <div v-else-if="block.lang === 'markdown' || block.lang === 'md'" class="chat-md text-(--ui-text-muted)" v-html="renderMarkdown(block.content)" />

              <!-- Mermaid diagram -->
              <div v-else-if="block.lang === 'mermaid'" class="relative group">
                <div class="flex items-center justify-between px-2 py-1 bg-(--ui-bg-elevated) rounded-t-md border border-b-0 border-(--ui-border)">
                  <span class="text-xs text-(--ui-text-dimmed) font-mono">mermaid</span>
                  <UButton
                    icon="i-lucide-clipboard"
                    label="Copy"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    @click="copyToClipboard(block.content)"
                  />
                </div>
                <div class="border border-(--ui-border) rounded-b-md overflow-hidden">
                  <ChatMermaidBlock :code="block.content" />
                </div>
              </div>

              <!-- Large code block (full file) → compact card -->
              <div v-else-if="isLargeCodeBlock(block)" class="rounded-md border border-(--ui-border) overflow-hidden">
                <div class="flex items-center justify-between px-2 py-1.5 bg-(--ui-bg-elevated)">
                  <div class="flex items-center gap-1.5">
                    <UIcon :name="block.unclosed ? 'i-lucide-loader' : 'i-lucide-file-code'" :class="[block.unclosed ? 'animate-spin' : '', 'size-3.5 text-(--ui-primary)']" />
                    <span class="text-xs font-medium text-(--ui-text-highlighted)">{{ block.lang || 'code' }}</span>
                    <span v-if="block.unclosed" class="text-xs text-(--ui-text-dimmed)">writing...</span>
                    <span v-else class="text-xs text-(--ui-text-dimmed)">{{ block.content.split('\n').length }} lines</span>
                  </div>
                  <div class="flex gap-1">
                    <UButton
                      :icon="expandedBlocks.has(`${msg.id}-${j}`) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      @click="toggleExpand(`${msg.id}-${j}`)"
                    />
                    <UButton
                      icon="i-lucide-clipboard"
                      label="Copy"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      @click="copyToClipboard(block.content)"
                    />
                    <UButton
                      v-if="!block.unclosed"
                      icon="i-lucide-git-compare"
                      label="Apply"
                      color="primary"
                      variant="soft"
                      size="xs"
                      @click="applyCode(block.content)"
                    />
                  </div>
                </div>
                <pre v-if="expandedBlocks.has(`${msg.id}-${j}`)" class="px-3 py-2 bg-(--ui-bg-elevated) border-t border-(--ui-border) overflow-x-auto text-xs font-mono text-(--ui-text) max-h-[300px] overflow-y-auto"><code>{{ block.content }}</code></pre>
              </div>

              <!-- Small code block → show inline -->
              <div v-else class="relative group">
                <div class="flex items-center justify-between px-2 py-1 bg-(--ui-bg-elevated) rounded-t-md border border-b-0 border-(--ui-border)">
                  <span class="text-xs text-(--ui-text-dimmed) font-mono">{{ block.lang || 'code' }}</span>
                  <div class="flex gap-1">
                    <UButton
                      icon="i-lucide-clipboard"
                      label="Copy"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      @click="copyToClipboard(block.content)"
                    />
                    <UButton
                      icon="i-lucide-replace"
                      label="Apply"
                      color="primary"
                      variant="ghost"
                      size="xs"
                      @click="applyCode(block.content)"
                    />
                  </div>
                </div>
                <pre class="px-3 py-2 bg-(--ui-bg-elevated) rounded-b-md border border-(--ui-border) overflow-x-auto text-xs font-mono text-(--ui-text)"><code>{{ block.content }}</code></pre>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- Input -->
      <div class="border-t border-(--ui-border) p-3 shrink-0">
        <div v-if="chat?.error" class="mb-2 text-xs text-(--ui-error)">
          {{ chat.error.message }}
          <UButton label="Retry" size="xs" variant="ghost" color="error" @click="chat.reload()" />
        </div>
        <div class="flex gap-2">
          <UTextarea
            v-model="input"
            placeholder="Ask about this code..."
            :rows="1"
            autoresize
            class="flex-1"
            @keydown.enter.exact.prevent="sendMessage"
          />
          <UButton
            v-if="chat?.status === 'streaming'"
            icon="i-lucide-square"
            color="error"
            variant="soft"
            @click="chat.stop()"
          />
          <UButton
            v-else
            icon="i-lucide-send"
            color="primary"
            variant="soft"
            :disabled="!input.trim()"
            @click="sendMessage"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Chat } from "@ai-sdk/vue";
import { DefaultChatTransport } from "ai";
import MarkdownItModule from "markdown-it";

const MarkdownIt = (MarkdownItModule as any).default || MarkdownItModule;

const props = defineProps<{
  codeGetter?: () => string;
  fileNameGetter?: () => string;
  slug?: string;
}>();

const emit = defineEmits<{
  applyCode: [code: string];
  applyCodeDirect: [code: string];
}>();

interface Block {
  type: "text" | "code";
  content: string;
  lang?: string;
  unclosed?: boolean;
}

interface ChatHistoryEntry {
  id: string;
  label: string;
  createdAt: number;
  messages: any[];
}

const MODELS = [
  { value: "codestral-latest", label: "Codestral", desc: "Coding" },
  { value: "mistral-large-latest", label: "Mistral Large", desc: "Most capable" },
  { value: "mistral-small-latest", label: "Mistral Small", desc: "Fast" },
];

const input = ref("");
const messagesContainer = ref<HTMLElement | null>(null);
const aiConfigured = ref(false);
const loading = ref(true);
const chat = shallowRef<Chat | null>(null);
const activeChatId = ref("");
const chatHistoryList = ref<ChatHistoryEntry[]>([]);
const selectedModel = ref("codestral-latest");
const autoApply = ref(localStorage.getItem("ai-auto-apply") !== "false"); // default on
// Fallback for when Chat class doesn't expose initialMessages properly
const restoredMessages = ref<any[]>([]);

const md = new MarkdownIt({ html: true, linkify: true, breaks: true });
const expandedBlocks = ref(new Set<string>());

function renderMarkdown(text: string): string {
  return md.render(text);
}

const quickPrompts = [
  "Explain what this assistant does",
  "Add error handling to the call flow",
  "Add a greeting audio before transfer",
  "Refactor to improve readability",
];

const activeChatLabel = computed(() => {
  const entry = chatHistoryList.value.find(h => h.id === activeChatId.value);
  return entry?.label || "Chat";
});

const historyMenuItems = computed(() => {
  return chatHistoryList.value.map(h => ({
    label: h.label,
    icon: h.id === activeChatId.value ? "i-lucide-check" : "i-lucide-message-square",
    onSelect: () => switchToChat(h.id),
  }));
});

const modelMenuItems = computed(() => {
  return MODELS.map(m => ({
    label: `${m.label} — ${m.desc}`,
    icon: m.value === selectedModel.value ? "i-lucide-check" : "i-lucide-cpu",
    onSelect: () => { selectedModel.value = m.value; },
  }));
});

const selectedModelLabel = computed(() => {
  return MODELS.find(m => m.value === selectedModel.value)?.label || "Codestral";
});

const settingsMenuItems = computed(() => [
  {
    label: autoApply.value ? "Auto-apply: ON" : "Auto-apply: OFF",
    icon: autoApply.value ? "i-lucide-zap" : "i-lucide-zap-off",
    onSelect: () => {
      autoApply.value = !autoApply.value;
      localStorage.setItem("ai-auto-apply", String(autoApply.value));
    },
  },
]);

// Merge Chat's live messages with restored history as fallback
const displayMessages = computed(() => {
  const live = chat.value?.messages || [];
  if (live.length > 0) return live;
  return restoredMessages.value;
});

// --- Chat history management (server-side) ---

async function loadHistoryIndex(): Promise<ChatHistoryEntry[]> {
  try {
    const data: any = await $fetch("/api/chats");
    return (data.chats || []).map((c: any) => ({ ...c, messages: [] }));
  } catch (e) {
    console.error("[AI Chat] Failed to load chat index:", e);
    return [];
  }
}

function saveChatMessages(chatId: string) {
  if (!chat.value) return;
  const serialized = chat.value.messages.map((m: any) => ({
    id: m.id,
    role: m.role,
    parts: m.parts,
  }));

  // Derive label from first user message
  const firstUser = chat.value.messages.find((m: any) => m.role === "user");
  const label = firstUser?.parts?.find((p: any) => p.type === "text")?.text?.slice(0, 40) || "Chat";

  // Update local state immediately
  const entry = chatHistoryList.value.find(h => h.id === chatId);
  if (entry) entry.label = label;

  // Fire-and-forget server save
  $fetch(`/api/chats/${chatId}`, {
    method: "PUT",
    body: { messages: serialized, label },
  }).catch((e) => console.error("[AI Chat] Failed to save:", e));
}

async function loadChatMessages(chatId: string): Promise<any[]> {
  try {
    const data: any = await $fetch(`/api/chats/${chatId}`);
    return data.messages || [];
  } catch (e) {
    console.error("[AI Chat] Failed to load chat:", e);
    return [];
  }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function createChatInstance(initialMessages?: any[]): Chat {
  const transport = new DefaultChatTransport({
    api: "/api/code-chat",
    body: () => ({
      code: props.codeGetter?.() || "",
      fileName: props.fileNameGetter?.() || "",
      slug: props.slug || "",
      model: selectedModel.value,
    }),
  });

  return new Chat({
    transport,
    initialMessages,
    onFinish: (event) => {
      try {
        if (restoredMessages.value.length > 0) restoredMessages.value = [];
        scrollToBottom();
        saveChatMessages(activeChatId.value);
      } catch (e) {
        console.error("[AI Chat] onFinish error:", e);
      }
    },
  });
}

function newChat() {
  // Save current before switching
  if (activeChatId.value && chat.value) {
    saveChatMessages(activeChatId.value);
  }

  const id = generateId();
  chatHistoryList.value.unshift({
    id,
    label: "New chat",
    createdAt: Date.now(),
    messages: [],
  });

  activeChatId.value = id;
  restoredMessages.value = [];
  chat.value = createChatInstance();
}

async function switchToChat(id: string) {
  if (id === activeChatId.value) return;

  // Save current
  if (activeChatId.value && chat.value) {
    saveChatMessages(activeChatId.value);
  }

  activeChatId.value = id;
  const messages = await loadChatMessages(id);
  restoredMessages.value = messages;
  chat.value = createChatInstance(messages.length > 0 ? messages : undefined);
  scrollToBottom();
}

async function deleteCurrentChat() {
  if (!activeChatId.value) return;

  const idToDelete = activeChatId.value;

  // Remove from server (fire-and-forget)
  $fetch(`/api/chats/${idToDelete}`, { method: "DELETE" })
    .catch((e) => console.error("[AI Chat] Failed to delete:", e));

  chatHistoryList.value = chatHistoryList.value.filter(h => h.id !== idToDelete);

  // Switch to another or create new
  if (chatHistoryList.value.length > 0) {
    await switchToChat(chatHistoryList.value[0].id);
  } else {
    newChat();
  }
}

// --- AI status check ---

async function checkAiStatus() {
  loading.value = true;
  try {
    // Cache-bust to avoid stale responses after HMR
    const data: any = await $fetch(`/api/ai-status?t=${Date.now()}`);
    aiConfigured.value = !!data?.configured;
    if (aiConfigured.value) await initChatSystem();
  } catch (e) {
    console.error("[AI Chat] Status check failed:", e);
    aiConfigured.value = false;
  } finally {
    loading.value = false;
  }
}

async function initChatSystem() {
  // Load history index from server
  chatHistoryList.value = await loadHistoryIndex();

  if (chatHistoryList.value.length > 0) {
    // Resume most recent chat
    const mostRecent = chatHistoryList.value[0];
    activeChatId.value = mostRecent.id;
    const messages = await loadChatMessages(mostRecent.id);
    restoredMessages.value = messages;
    chat.value = createChatInstance(messages.length > 0 ? messages : undefined);
  } else {
    // First time — create a new chat
    newChat();
  }
}

// --- Message parsing ---

function parseMessageBlocks(msg: any): Block[] {
  const fullText = msg.parts
    ?.filter((p: any) => p.type === "text")
    .map((p: any) => p.text)
    .join("") || "";

  return parseBlocks(fullText);
}

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let i = 0;
  let textBuffer: string[] = [];

  function flushText() {
    const content = textBuffer.join("\n").trim();
    if (content) blocks.push({ type: "text", content });
    textBuffer = [];
  }

  while (i < lines.length) {
    // Opening fence: ``` with optional language, nothing else on the line
    const fenceMatch = lines[i].match(/^(`{3,})(\w*)\s*$/);
    if (fenceMatch) {
      flushText();
      const fenceLen = fenceMatch[1].length;
      const lang = fenceMatch[2] || undefined;
      const codeLines: string[] = [];
      i++;
      // Closing fence: same or more backticks, NO language (bare fence)
      const closeRe = new RegExp(`^\`{${fenceLen},}\\s*$`);
      let unclosed = false;
      while (i < lines.length && !closeRe.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        i++; // skip closing fence
      } else {
        unclosed = true; // no closing fence — still streaming
      }
      const content = codeLines.join("\n").trim();
      if (content) blocks.push({ type: "code", content, lang, unclosed });
    } else {
      textBuffer.push(lines[i]);
      i++;
    }
  }

  flushText();
  return blocks.length ? blocks : [{ type: "text", content: text }];
}

function isLargeCodeBlock(block: Block): boolean {
  if (block.type !== "code") return false;
  // Always collapse unclosed blocks (still streaming) to prevent flash
  if (block.unclosed) return true;
  return block.content.split("\n").length > 15;
}

function toggleExpand(key: string) {
  const s = new Set(expandedBlocks.value);
  if (s.has(key)) s.delete(key); else s.add(key);
  expandedBlocks.value = s;
}

// Manual Apply button → directly set code in editor (no diff)
function applyCode(code: string) {
  if (!code) return;
  emit("applyCodeDirect", code);
}

// Auto-apply → directly set code in editor (same as manual Apply)
function autoApplyLastCodeBlock(message?: any) {
  if (!autoApply.value) return;
  if (!message || message.role !== "assistant") return;

  const blocks = parseMessageBlocks(message);
  const codeBlocks = blocks.filter(
    (b) => b.type === "code" && b.content.split("\n").length > 15
  );
  if (codeBlocks.length > 0) {
    emit("applyCodeDirect", codeBlocks[codeBlocks.length - 1].content);
  }
}

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

function sendMessage() {
  const text = input.value.trim();
  if (!text || !chat.value || chat.value.status === "streaming") return;

  chat.value.sendMessage({ text });
  input.value = "";
  scrollToBottom();
}

function sendQuick(text: string) {
  if (!chat.value || chat.value.status === "streaming") return;
  chat.value.sendMessage({ text });
  scrollToBottom();
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
}

// Auto-scroll during streaming
watch(
  () => chat.value?.messages.length,
  () => scrollToBottom()
);

// Watch for stream completion → auto-apply
let lastAutoAppliedId = "";
watch(
  () => chat.value?.status,
  (status, prevStatus) => {
    if (prevStatus === "streaming" && status !== "streaming") {
      // Stream just finished — try auto-apply
      nextTick(() => {
        if (!autoApply.value) return;
        const msgs = chat.value?.messages || [];
        if (msgs.length === 0) return;
        const lastMsg = msgs[msgs.length - 1];
        if (!lastMsg || lastMsg.role !== "assistant") return;
        if (lastMsg.id === lastAutoAppliedId) return; // already applied
        lastAutoAppliedId = lastMsg.id;
        autoApplyLastCodeBlock(lastMsg);
      });
    }
  }
);

onMounted(() => checkAiStatus());
</script>

<style scoped>
.chat-md :deep(h1) { font-size: 1.15em; font-weight: 700; margin: 0.5em 0 0.25em; color: var(--ui-text-highlighted); }
.chat-md :deep(h2) { font-size: 1.1em; font-weight: 600; margin: 0.5em 0 0.25em; color: var(--ui-text-highlighted); }
.chat-md :deep(h3) { font-size: 1.05em; font-weight: 600; margin: 0.4em 0 0.2em; color: var(--ui-text-highlighted); }
.chat-md :deep(h4),
.chat-md :deep(h5),
.chat-md :deep(h6) { font-size: 1em; font-weight: 600; margin: 0.3em 0 0.15em; }
.chat-md :deep(p) { margin: 0.3em 0; line-height: 1.5; }
.chat-md :deep(ul),
.chat-md :deep(ol) { padding-left: 1.5em; margin: 0.3em 0; }
.chat-md :deep(li) { margin: 0.15em 0; line-height: 1.4; }
.chat-md :deep(li > p) { margin: 0.1em 0; }
.chat-md :deep(strong) { font-weight: 600; color: var(--ui-text); }
.chat-md :deep(em) { font-style: italic; }
.chat-md :deep(code) {
  background: var(--ui-bg-elevated);
  padding: 0.15em 0.35em;
  border-radius: 4px;
  font-size: 0.88em;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}
.chat-md :deep(pre) {
  background: var(--ui-bg-elevated);
  padding: 0.75em;
  border-radius: 6px;
  overflow-x: auto;
  margin: 0.3em 0;
  font-size: 0.88em;
}
.chat-md :deep(pre code) {
  background: none;
  padding: 0;
  border-radius: 0;
}
.chat-md :deep(blockquote) {
  border-left: 3px solid var(--ui-border);
  padding-left: 0.75em;
  margin: 0.3em 0;
  color: var(--ui-text-dimmed);
}
.chat-md :deep(a) {
  color: var(--ui-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.chat-md :deep(hr) {
  border: none;
  border-top: 1px solid var(--ui-border);
  margin: 0.5em 0;
}
.chat-md :deep(table) {
  border-collapse: collapse;
  margin: 0.3em 0;
  font-size: 0.9em;
  width: 100%;
}
.chat-md :deep(th),
.chat-md :deep(td) {
  border: 1px solid var(--ui-border);
  padding: 0.3em 0.5em;
  text-align: left;
}
.chat-md :deep(th) {
  font-weight: 600;
  background: var(--ui-bg-elevated);
}
.chat-md :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  margin: 0.3em 0;
}
</style>
