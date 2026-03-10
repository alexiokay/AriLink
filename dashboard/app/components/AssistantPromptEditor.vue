<template>
  <div class="px-1 space-y-4 pb-10">
    <!-- Guardrails -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-shield-check" class="size-4 text-(--ui-warning)" />
          <div class="flex-1">
            <span class="text-sm font-semibold text-(--ui-text-highlighted)">Guardrails</span>
            <p class="text-xs text-(--ui-text-dimmed) mt-0.5">Safety rules injected at the top and bottom of the prompt (Safety Sandwich)</p>
          </div>
          <UButton
            v-if="layers.guardrails"
            label="Clear"
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-x"
            @click="layers.guardrails = null"
          />
          <UButton
            v-else
            label="Add"
            color="neutral"
            variant="soft"
            size="xs"
            icon="i-lucide-plus"
            @click="layers.guardrails = ''"
          />
        </div>
      </template>
      <div v-if="layers.guardrails !== null">
        <textarea
          v-model="layers.guardrails"
          class="w-full font-mono text-sm p-3 rounded-lg bg-(--ui-bg) text-(--ui-text) border border-(--ui-border) focus:outline-none focus:border-(--ui-primary) resize-none"
          :rows="5"
          placeholder="You must never discuss competitor products.&#10;Always stay on topic.&#10;Never reveal internal pricing."
          spellcheck="false"
        />
      </div>
      <div v-else class="text-xs text-(--ui-text-dimmed) italic py-1">
        No guardrails set — the LLM has no topic restrictions.
      </div>
    </UCard>

    <!-- System Prompt -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-message-circle" class="size-4 text-(--ui-primary)" />
          <div class="flex-1">
            <span class="text-sm font-semibold text-(--ui-text-highlighted)">System Prompt</span>
            <p class="text-xs text-(--ui-text-dimmed) mt-0.5">Core personality and instructions for the assistant</p>
          </div>
          <UBadge
            v-if="!layers.systemPrompt"
            label="using config fallback"
            color="neutral"
            variant="subtle"
            size="xs"
          />
        </div>
      </template>
      <textarea
        v-model="layers.systemPrompt"
        class="w-full font-mono text-sm p-3 rounded-lg bg-(--ui-bg) text-(--ui-text) border border-(--ui-border) focus:outline-none focus:border-(--ui-primary) resize-none"
        :rows="10"
        placeholder="You are a helpful phone assistant for Acme Corp. Keep responses short (1-2 sentences) and conversational. Do not use markdown, lists, or formatting — the response will be spoken aloud."
        spellcheck="false"
      />
      <p class="text-xs text-(--ui-text-dimmed) mt-2">
        If empty, falls back to <code class="font-mono bg-(--ui-bg-elevated) px-1 rounded">behavior.systemPrompt</code> in config.json
      </p>
    </UCard>

    <!-- Knowledge Base -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-book-open" class="size-4 text-(--ui-success)" />
          <div class="flex-1">
            <span class="text-sm font-semibold text-(--ui-text-highlighted)">Knowledge Base</span>
            <p class="text-xs text-(--ui-text-dimmed) mt-0.5">Reference documents injected into the prompt (FAQs, product info, scripts)</p>
          </div>
          <UButton
            label="Add File"
            color="neutral"
            variant="soft"
            size="xs"
            icon="i-lucide-plus"
            @click="openAddKnowledge"
          />
        </div>
      </template>

      <div v-if="layers.knowledge.length === 0" class="text-xs text-(--ui-text-dimmed) italic py-1">
        No knowledge files — add .md documents for the assistant to reference.
      </div>

      <div v-else class="space-y-1">
        <div
          v-for="(kf, idx) in layers.knowledge"
          :key="kf.name"
          class="knowledge-row group flex items-center gap-3 px-3 py-2 rounded-lg border border-transparent transition-colors"
        >
          <UIcon name="i-lucide-file-text" class="size-4 shrink-0 text-(--ui-text-dimmed)" />
          <span class="flex-1 text-sm font-mono text-(--ui-text)">{{ kf.name }}.md</span>
          <span class="text-xs text-(--ui-text-dimmed)">{{ wordCount(kf.content) }} words</span>
          <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <UButton
              icon="i-lucide-pencil"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="editKnowledge(idx)"
            />
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="xs"
              @click="deleteKnowledge(idx)"
            />
          </div>
        </div>
      </div>
    </UCard>

    <!-- Tools -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-wrench" class="size-4 text-(--ui-info)" />
          <div class="flex-1">
            <span class="text-sm font-semibold text-(--ui-text-highlighted)">Tools</span>
            <p class="text-xs text-(--ui-text-dimmed) mt-0.5">Functions the LLM can call — HTTP APIs, webhooks, shell commands, Node.js modules</p>
          </div>
          <UButton label="Add Tool" color="neutral" variant="soft" size="xs" icon="i-lucide-plus" @click="openAddTool" />
        </div>
      </template>

      <!-- Static tools list -->
      <div v-if="tools.length === 0" class="text-xs text-(--ui-text-dimmed) italic py-1 mb-3">
        No tools — the LLM cannot call external APIs or run actions.
      </div>
      <div v-else class="space-y-1 mb-4">
        <div
          v-for="(tool, idx) in tools"
          :key="tool.name"
          class="tool-row group flex items-start gap-3 px-3 py-2.5 rounded-lg border border-transparent transition-colors"
        >
          <UIcon :name="handlerIcon(tool.handlerType)" class="size-4 mt-0.5 shrink-0 text-(--ui-text-dimmed)" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-medium font-mono text-(--ui-text-highlighted)">{{ tool.name }}</span>
              <UBadge :label="tool.handlerType" :color="handlerColor(tool.handlerType) as any" variant="subtle" size="xs" />
            </div>
            <p class="text-xs text-(--ui-text-dimmed) mt-0.5 line-clamp-1">{{ tool.description || '(no description)' }}</p>
          </div>
          <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <UButton icon="i-lucide-pencil" color="neutral" variant="ghost" size="xs" @click="openEditTool(idx)" />
            <UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="xs" @click="deleteTool(idx)" />
          </div>
        </div>
      </div>

      <!-- MCP Servers section -->
      <div class="border-t border-(--ui-border) pt-3 mt-1">
        <div class="flex items-center gap-2 mb-2">
          <UIcon name="i-lucide-plug" class="size-3.5 text-(--ui-text-dimmed)" />
          <span class="text-xs font-semibold text-(--ui-text-muted)">MCP Servers</span>
          <span class="text-xs text-(--ui-text-dimmed)">— tools auto-discovered at call start</span>
          <UButton label="Add Server" color="neutral" variant="ghost" size="xs" icon="i-lucide-plus" class="ml-auto" @click="addMcpServer" />
        </div>
        <div v-if="mcpServers.length === 0" class="text-xs text-(--ui-text-dimmed) italic py-1 pl-1">
          No MCP servers configured.
        </div>
        <div v-else class="space-y-2">
          <div v-for="(server, idx) in mcpServers" :key="idx" class="space-y-1.5">
            <!-- URL row -->
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-server" class="size-3.5 text-(--ui-text-dimmed) shrink-0" />
              <UInput v-model="server.url" placeholder="http://localhost:3100" class="flex-1 font-mono" size="sm" />
              <UInput v-model="server.name" placeholder="Label (optional)" class="w-32" size="sm" />
              <UButton
                icon="i-lucide-search"
                color="neutral"
                variant="soft"
                size="xs"
                :loading="mcpDiscovery[idx]?.loading"
                :disabled="!server.url.trim()"
                title="Discover tools from this MCP server"
                @click="discoverMcp(idx)"
              />
              <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="xs" @click="removeMcpServer(idx)" />
            </div>
            <!-- Discovered tools -->
            <div v-if="mcpDiscovery[idx]?.tools?.length" class="pl-5 flex flex-wrap gap-1">
              <UBadge
                v-for="t in mcpDiscovery[idx].tools"
                :key="t.name"
                :label="t.name"
                color="info"
                variant="subtle"
                size="xs"
                class="cursor-default"
                :title="t.description || t.name"
              />
            </div>
            <div v-if="mcpDiscovery[idx]?.tools?.length === 0 && !mcpDiscovery[idx]?.loading && mcpDiscovery[idx]?.error === null && idx in mcpDiscovery" class="pl-5 text-xs text-(--ui-text-dimmed) italic">
              No tools returned by this server.
            </div>
            <div v-if="mcpDiscovery[idx]?.error" class="pl-5 text-xs text-(--ui-error)">
              {{ mcpDiscovery[idx].error }}
            </div>
          </div>
        </div>
      </div>
    </UCard>

    <!-- Save status -->
    <transition name="fade">
      <div v-if="saveMessage" class="flex items-center gap-2 text-xs font-medium px-1" :class="saveError ? 'text-(--ui-error)' : 'text-(--ui-success)'">
        <UIcon :name="saveError ? 'i-lucide-alert-circle' : 'i-lucide-check-circle'" class="size-3.5" />
        {{ saveMessage }}
      </div>
    </transition>
  </div>

  <!-- ── Tool edit modal ── -->
  <UModal v-model:open="showToolModal" :ui="{ content: 'max-w-2xl' }">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon :name="handlerIcon(editingTool.handlerType)" class="size-4 text-(--ui-primary)" />
            <span class="font-semibold text-(--ui-text-highlighted)">
              {{ editingToolIdx === -1 ? 'Add Tool' : 'Edit Tool' }}
            </span>
          </div>
        </template>

        <div class="space-y-4 max-h-[68vh] overflow-y-auto pr-1">
          <!-- Name + Type row -->
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Tool Name" required hint="snake_case, used by LLM">
              <UInput v-model="editingTool.name" placeholder="check_availability" class="font-mono" />
            </UFormField>
            <UFormField label="Handler Type">
              <USelect v-model="editingTool.handlerType" :items="HANDLER_TYPES" />
            </UFormField>
          </div>

          <UFormField label="Description" required hint="Tell the LLM when and why to call this">
            <UTextarea v-model="editingTool.description" :rows="2" placeholder="Check available appointment slots for a given date. Call when the user asks about availability or wants to book." />
          </UFormField>

          <!-- Handler-specific config -->
          <div class="rounded-lg border border-(--ui-border) p-3 space-y-3 bg-(--ui-bg-elevated)">
            <p class="text-xs font-semibold text-(--ui-text-muted) uppercase tracking-wide">
              {{ editingTool.handlerType.toUpperCase() }} Config
            </p>

            <!-- HTTP -->
            <template v-if="editingTool.handlerType === 'http'">
              <div class="flex gap-2">
                <UFormField label="Method" class="w-28 shrink-0">
                  <USelect v-model="editingTool.method" :items="['GET', 'POST', 'PUT', 'PATCH', 'DELETE']" />
                </UFormField>
                <UFormField label="URL" class="flex-1">
                  <UInput v-model="editingTool.url" placeholder="https://api.example.com/slots" class="font-mono text-xs" />
                </UFormField>
              </div>
              <KVSection label="Query Params" :pairs="editingTool.query" kp="param" vp="{{date}}" />
              <KVSection label="Headers" :pairs="editingTool.headers" kp="Authorization" vp="Bearer {{env.API_KEY}}" />
              <KVSection v-if="editingTool.method !== 'GET'" label="Body Fields" :pairs="editingTool.body" kp="field" vp="{{argName}}" />
              <UFormField label="Timeout ms" hint="Default: 10000">
                <UInput v-model="editingTool.timeout" type="number" placeholder="10000" class="w-28" size="sm" />
              </UFormField>
            </template>

            <!-- Webhook -->
            <template v-else-if="editingTool.handlerType === 'webhook'">
              <UFormField label="URL">
                <UInput v-model="editingTool.url" placeholder="https://hooks.example.com/trigger" class="font-mono text-xs" />
              </UFormField>
              <KVSection label="Headers" :pairs="editingTool.headers" kp="Authorization" vp="Bearer {{env.TOKEN}}" />
              <UFormField label="Timeout ms" hint="Default: 10000">
                <UInput v-model="editingTool.timeout" type="number" placeholder="10000" class="w-28" size="sm" />
              </UFormField>
            </template>

            <!-- Transfer -->
            <template v-else-if="editingTool.handlerType === 'transfer'">
              <UFormField label="Extension" hint="SIP extension or endpoint to transfer the call to">
                <UInput v-model="editingTool.extension" placeholder="200" class="w-32 font-mono" />
              </UFormField>
            </template>

            <!-- Hangup -->
            <template v-else-if="editingTool.handlerType === 'hangup'">
              <p class="text-xs text-(--ui-text-dimmed)">When called, immediately ends the call. No configuration needed.</p>
            </template>

            <!-- Shell -->
            <template v-else-if="editingTool.handlerType === 'shell'">
              <UFormField label="Command" hint="Use {{argName}} for argument substitution">
                <UInput v-model="editingTool.command" placeholder="python3 /scripts/lookup.py {{phone}}" class="font-mono text-xs" />
              </UFormField>
              <UFormField label="Timeout ms" hint="Default: 10000">
                <UInput v-model="editingTool.timeout" type="number" placeholder="10000" class="w-28" size="sm" />
              </UFormField>
            </template>

            <!-- Module -->
            <template v-else-if="editingTool.handlerType === 'module'">
              <UFormField label="File Path" hint="Relative to assistant dir (e.g. tools/book.ts)">
                <UInput v-model="editingTool.file" placeholder="tools/book-appointment.ts" class="font-mono text-xs" />
              </UFormField>
              <p class="text-xs text-(--ui-text-dimmed)">
                Must export: <code v-pre class="bg-(--ui-bg) border border-(--ui-border) px-1.5 py-0.5 rounded font-mono text-xs">export async function execute(args, ctx) { return "result"; }</code>
              </p>
              <p class="text-xs text-(--ui-text-dimmed)">
                Return <code v-pre class="bg-(--ui-bg) border border-(--ui-border) px-1 rounded font-mono text-xs">"__transfer__:200"</code> or <code v-pre class="bg-(--ui-bg) border border-(--ui-border) px-1 rounded font-mono text-xs">"__hangup__"</code> for call control.
              </p>
            </template>
          </div>

          <!-- Parameters -->
          <div>
            <div class="flex items-center gap-2 mb-2">
              <span class="text-sm font-semibold text-(--ui-text-highlighted)">Parameters</span>
              <span class="text-xs text-(--ui-text-dimmed)">Arguments the LLM extracts from the conversation</span>
              <UButton label="Add" color="neutral" variant="soft" size="xs" icon="i-lucide-plus" class="ml-auto" @click="addParam" />
            </div>
            <div v-if="editingTool.params.length === 0" class="text-xs text-(--ui-text-dimmed) italic py-1">
              No parameters — LLM calls this tool without arguments.
            </div>
            <div v-else class="space-y-1.5">
              <div class="grid grid-cols-[1fr_auto_2fr_auto_auto] gap-1.5 text-xs text-(--ui-text-dimmed) px-1 mb-0.5">
                <span>Name</span><span>Type</span><span>Description</span><span>Req</span><span></span>
              </div>
              <div v-for="(param, pidx) in editingTool.params" :key="pidx" class="grid grid-cols-[1fr_auto_2fr_auto_auto] gap-1.5 items-center">
                <UInput v-model="param.name" placeholder="date" class="font-mono" size="sm" />
                <USelect v-model="param.type" :items="PARAM_TYPES" size="sm" class="w-24" />
                <UInput v-model="param.description" placeholder="Natural date like 'Monday'" size="sm" />
                <input type="checkbox" v-model="param.required" class="w-4 h-4 mx-auto rounded cursor-pointer" />
                <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="xs" @click="removeParam(pidx)" />
              </div>
            </div>
          </div>
        </div>

        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton label="Cancel" color="neutral" variant="ghost" @click="showToolModal = false" />
            <UButton
              :label="editingToolIdx === -1 ? 'Add Tool' : 'Save Tool'"
              color="primary"
              icon="i-lucide-save"
              :disabled="!editingTool.name.trim() || !editingTool.description.trim()"
              @click="saveToolModal"
            />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>

  <!-- ── Knowledge edit modal ── -->
  <UModal v-model:open="showKnowledgeModal">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-file-text" class="size-4 text-(--ui-primary)" />
            <span class="font-semibold text-(--ui-text-highlighted)">
              {{ editingKnowledgeIdx === -1 ? 'Add Knowledge File' : 'Edit Knowledge File' }}
            </span>
          </div>
        </template>

        <div class="space-y-3">
          <UFormField label="File name" hint="Saved as {name}.md">
            <UInput
              v-model="knowledgeEditName"
              placeholder="faq"
              :disabled="editingKnowledgeIdx !== -1"
              class="font-mono"
            />
          </UFormField>
          <UFormField label="Content (Markdown)">
            <textarea
              v-model="knowledgeEditContent"
              class="w-full font-mono text-sm p-3 rounded-lg bg-(--ui-bg) text-(--ui-text) border border-(--ui-border) focus:outline-none focus:border-(--ui-primary) resize-none"
              :rows="14"
              placeholder="# FAQ&#10;&#10;**Q: What are your hours?**&#10;A: We are open Monday to Friday, 9am to 5pm."
              spellcheck="false"
            />
          </UFormField>
        </div>

        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton label="Cancel" color="neutral" variant="ghost" @click="showKnowledgeModal = false" />
            <UButton
              :label="editingKnowledgeIdx === -1 ? 'Add' : 'Save'"
              color="primary"
              icon="i-lucide-save"
              :disabled="!knowledgeEditName.trim() || !knowledgeEditContent.trim()"
              @click="saveKnowledge"
            />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>

<!-- Inline KVSection component for key-value pair builders in the tool modal -->
<script lang="ts">
// Sub-component defined inline to avoid a separate file
const KVSection = defineComponent({
  props: {
    label: String,
    pairs: { type: Array as PropType<Array<{ key: string; value: string }>>, required: true },
    kp: { type: String, default: 'key' },
    vp: { type: String, default: 'value' },
  },
  setup(props) {
    return () => h('div', [
      h('div', { class: 'flex items-center gap-2 mb-1' }, [
        h('span', { class: 'text-xs text-(--ui-text-muted) font-medium' }, props.label),
        h('button', {
          class: 'ml-auto text-xs text-(--ui-primary) hover:underline',
          onClick: () => props.pairs.push({ key: '', value: '' }),
        }, '+ Add'),
      ]),
      ...props.pairs.map((kv: any, i: number) =>
        h('div', { key: i, class: 'flex gap-1.5 mb-1' }, [
          h('input', {
            value: kv.key,
            onInput: (e: any) => { kv.key = e.target.value; },
            placeholder: props.kp,
            class: 'w-32 shrink-0 font-mono text-xs px-2 py-1 rounded border border-(--ui-border) bg-(--ui-bg) text-(--ui-text) focus:outline-none focus:border-(--ui-primary)',
          }),
          h('input', {
            value: kv.value,
            onInput: (e: any) => { kv.value = e.target.value; },
            placeholder: props.vp,
            class: 'flex-1 font-mono text-xs px-2 py-1 rounded border border-(--ui-border) bg-(--ui-bg) text-(--ui-text) focus:outline-none focus:border-(--ui-primary)',
          }),
          h('button', {
            class: 'text-(--ui-text-dimmed) hover:text-(--ui-error) px-1',
            onClick: () => props.pairs.splice(i, 1),
          }, '×'),
        ])
      ),
    ]);
  },
});
</script>

<script setup lang="ts">
import { defineComponent, h, type PropType } from 'vue';

interface KnowledgeFile { name: string; content: string }
interface LayersData {
  systemPrompt: string | null;
  guardrails: string | null;
  knowledge: KnowledgeFile[];
}

interface KVPair { key: string; value: string }

interface ParsedToolParam {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

interface ParsedTool {
  name: string;
  description: string;
  params: ParsedToolParam[];
  handlerType: string;
  // http / webhook
  url: string;
  method: string;
  query: KVPair[];
  headers: KVPair[];
  body: KVPair[];
  timeout: string;
  // transfer
  extension: string;
  // shell
  command: string;
  // module
  file: string;
}

interface McpServer { url: string; name: string }

const HANDLER_TYPES = ['http', 'webhook', 'transfer', 'hangup', 'shell', 'module'];
const PARAM_TYPES   = ['string', 'number', 'integer', 'boolean'];

const props = defineProps<{ slug: string }>();

const layers    = ref<LayersData>({ systemPrompt: null, guardrails: null, knowledge: [] });
const tools     = ref<ParsedTool[]>([]);
const mcpServers = ref<McpServer[]>([]);
const mcpDiscovery = ref<Record<number, { loading: boolean; tools: { name: string; description: string }[]; error: string | null }>>({});
const originalLayers = ref<string>("");
const saving    = ref(false);
const saveMessage = ref("");
const saveError = ref(false);

// ── Tool modal ──
const showToolModal   = ref(false);
const editingToolIdx  = ref(-1);
const editingTool     = ref<ParsedTool>(blankTool());

// ── Knowledge modal ──
const showKnowledgeModal   = ref(false);
const editingKnowledgeIdx  = ref(-1);
const knowledgeEditName    = ref("");
const knowledgeEditContent = ref("");

// ── helpers ──
function blankTool(): ParsedTool {
  return { name: '', description: '', params: [], handlerType: 'http',
    url: '', method: 'GET', query: [], headers: [], body: [], timeout: '',
    extension: '', command: '', file: '' };
}

function handlerIcon(type: string): string {
  const icons: Record<string, string> = {
    http: 'i-lucide-globe', webhook: 'i-lucide-webhook', transfer: 'i-lucide-phone-forwarded',
    hangup: 'i-lucide-phone-off', shell: 'i-lucide-terminal', module: 'i-lucide-code-2', mcp: 'i-lucide-plug',
  };
  return icons[type] || 'i-lucide-wrench';
}

function handlerColor(type: string): string {
  const colors: Record<string, string> = {
    http: 'primary', webhook: 'secondary', transfer: 'success',
    hangup: 'error', shell: 'warning', module: 'neutral', mcp: 'info',
  };
  return colors[type] || 'neutral';
}

// ── Serialization ──
function parseTool(t: any): ParsedTool | null {
  if (!t?.name || !t?.handler) return null;
  const h = t.handler;
  const kvFrom = (obj?: Record<string, string>): KVPair[] =>
    Object.entries(obj || {}).map(([key, value]) => ({ key, value }));
  const params: ParsedToolParam[] = [];
  if (t.parameters?.properties) {
    const req = new Set<string>(t.parameters.required || []);
    for (const [name, schema] of Object.entries<any>(t.parameters.properties)) {
      params.push({ name, type: schema.type || 'string', description: schema.description || '', required: req.has(name) });
    }
  }
  return {
    name: t.name, description: t.description || '', params,
    handlerType: h.type || 'http',
    url: h.url || '', method: h.method || 'GET',
    query: kvFrom(h.query), headers: kvFrom(h.headers), body: kvFrom(h.body),
    timeout: h.timeout ? String(h.timeout) : '',
    extension: h.extension || '', command: h.command || '', file: h.file || '',
  };
}

function serializeTool(t: ParsedTool): any {
  const kvTo = (arr: KVPair[]) =>
    arr.filter(kv => kv.key).reduce((o, kv) => ({ ...o, [kv.key]: kv.value }), {});
  const props: Record<string, any> = {};
  const required: string[] = [];
  for (const p of t.params) {
    props[p.name] = { type: p.type, description: p.description };
    if (p.required) required.push(p.name);
  }
  const handler: any = { type: t.handlerType };
  const tout = t.timeout ? parseInt(t.timeout) : undefined;
  if (t.handlerType === 'http') {
    handler.method = t.method; handler.url = t.url;
    const q = kvTo(t.query); if (Object.keys(q).length) handler.query = q;
    const hd = kvTo(t.headers); if (Object.keys(hd).length) handler.headers = hd;
    const bd = kvTo(t.body); if (Object.keys(bd).length) handler.body = bd;
    if (tout) handler.timeout = tout;
  } else if (t.handlerType === 'webhook') {
    handler.url = t.url;
    const hd = kvTo(t.headers); if (Object.keys(hd).length) handler.headers = hd;
    if (tout) handler.timeout = tout;
  } else if (t.handlerType === 'transfer') {
    handler.extension = t.extension;
  } else if (t.handlerType === 'shell') {
    handler.command = t.command;
    if (tout) handler.timeout = tout;
  } else if (t.handlerType === 'module') {
    handler.file = t.file;
  }
  return {
    name: t.name, description: t.description,
    parameters: { type: 'object', properties: props, required },
    handler,
  };
}

function toolsToJson(arr: ParsedTool[]): string {
  return JSON.stringify(arr.map(serializeTool), null, 2);
}

// ── Data loading / saving ──
async function fetchLayers() {
  try {
    const data: any = await $fetch(`/api/assistants/${props.slug}/layers`);
    layers.value = {
      systemPrompt: data.systemPrompt ?? null,
      guardrails:   data.guardrails   ?? null,
      knowledge:    data.knowledge    ?? [],
    };
    // Parse tools
    tools.value = data.toolsJson
      ? (JSON.parse(data.toolsJson) as any[]).map(parseTool).filter(Boolean) as ParsedTool[]
      : [];
    // MCP servers
    mcpServers.value = (data.mcpServers || []).map((s: any) => ({ url: s.url || '', name: s.name || '' }));
    originalLayers.value = JSON.stringify(layers.value);
  } catch (e) {
    console.error("Failed to fetch layers:", e);
  }
}

async function save() {
  if (!props.slug) return;
  saving.value = true;
  saveMessage.value = "";
  saveError.value = false;

  try {
    const toolsJson = tools.value.length ? toolsToJson(tools.value) : null;

    // Save system-prompt.md, guardrails.md, tools.json
    await $fetch(`/api/assistants/${props.slug}/layers`, {
      method: "PUT",
      body: {
        systemPrompt: layers.value.systemPrompt || null,
        guardrails:   layers.value.guardrails   || null,
        toolsJson,
      },
    });

    // Save MCP servers to config.json
    await $fetch(`/api/assistants/${props.slug}/mcp-servers`, {
      method: "PUT",
      body: { mcpServers: mcpServers.value.filter(s => s.url.trim()) },
    });

    // Sync knowledge files
    const original: LayersData = JSON.parse(originalLayers.value);
    const originalNames = new Set(original.knowledge.map((k) => k.name));
    const currentNames  = new Set(layers.value.knowledge.map((k) => k.name));

    for (const name of originalNames) {
      if (!currentNames.has(name)) {
        await $fetch(`/api/assistants/${props.slug}/layers/knowledge`, { method: "DELETE", body: { name } });
      }
    }
    for (const kf of layers.value.knowledge) {
      await $fetch(`/api/assistants/${props.slug}/layers/knowledge`, { method: "POST", body: { name: kf.name, content: kf.content } });
    }

    originalLayers.value = JSON.stringify(layers.value);
    saveMessage.value = "Saved successfully";
    setTimeout(() => { saveMessage.value = ""; }, 3000);
  } catch (e: any) {
    saveError.value = true;
    saveMessage.value = e.data?.message || e.message || "Failed to save";
    setTimeout(() => { saveMessage.value = ""; }, 4000);
  } finally {
    saving.value = false;
  }
}

// ── Tool CRUD ──
function openAddTool() {
  editingToolIdx.value = -1;
  editingTool.value = blankTool();
  showToolModal.value = true;
}

function openEditTool(idx: number) {
  editingToolIdx.value = idx;
  // deep clone so canceling doesn't mutate
  editingTool.value = JSON.parse(JSON.stringify(tools.value[idx]));
  showToolModal.value = true;
}

function deleteTool(idx: number) {
  tools.value.splice(idx, 1);
}

function saveToolModal() {
  if (!editingTool.value.name.trim()) return;
  const t = JSON.parse(JSON.stringify(editingTool.value)) as ParsedTool;
  if (editingToolIdx.value === -1) {
    tools.value.push(t);
  } else {
    tools.value[editingToolIdx.value] = t;
  }
  showToolModal.value = false;
}

function addParam() {
  editingTool.value.params.push({ name: '', type: 'string', description: '', required: false });
}
function removeParam(idx: number) {
  editingTool.value.params.splice(idx, 1);
}

// ── MCP servers ──
function addMcpServer() {
  mcpServers.value.push({ url: '', name: '' });
}
function removeMcpServer(idx: number) {
  mcpServers.value.splice(idx, 1);
  const d = { ...mcpDiscovery.value };
  delete d[idx];
  mcpDiscovery.value = d;
}
async function discoverMcp(idx: number) {
  const url = mcpServers.value[idx]?.url?.trim();
  if (!url) return;
  mcpDiscovery.value = { ...mcpDiscovery.value, [idx]: { loading: true, tools: [], error: null } };
  try {
    const res: any = await $fetch(`/api/assistants/${props.slug}/mcp-discover`, {
      method: "POST",
      body: { url },
    });
    mcpDiscovery.value = { ...mcpDiscovery.value, [idx]: { loading: false, tools: res.tools ?? [], error: null } };
  } catch (e: any) {
    const msg = e?.data?.message || e?.message || "Discovery failed";
    mcpDiscovery.value = { ...mcpDiscovery.value, [idx]: { loading: false, tools: [], error: msg } };
  }
}

// ── Knowledge CRUD ──
function openAddKnowledge() {
  editingKnowledgeIdx.value = -1;
  knowledgeEditName.value = "";
  knowledgeEditContent.value = "";
  showKnowledgeModal.value = true;
}

function editKnowledge(idx: number) {
  editingKnowledgeIdx.value = idx;
  const kf = layers.value.knowledge[idx];
  knowledgeEditName.value = kf?.name ?? '';
  knowledgeEditContent.value = kf?.content ?? '';
  showKnowledgeModal.value = true;
}

function saveKnowledge() {
  const name = knowledgeEditName.value.trim();
  if (!name || !knowledgeEditContent.value.trim()) return;
  if (editingKnowledgeIdx.value === -1) {
    layers.value.knowledge.push({ name, content: knowledgeEditContent.value });
  } else {
    const entry = layers.value.knowledge[editingKnowledgeIdx.value];
    if (entry) entry.content = knowledgeEditContent.value;
  }
  showKnowledgeModal.value = false;
}

function deleteKnowledge(idx: number) {
  layers.value.knowledge.splice(idx, 1);
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

watch(() => props.slug, () => { fetchLayers(); }, { immediate: true });

defineExpose({ save, saving });
</script>

<style scoped>
.knowledge-row:hover,
.tool-row:hover {
  background-color: var(--ui-bg-elevated);
  border-color: var(--ui-border);
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>
