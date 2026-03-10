<template>
  <div class="flow-builder">
    <!-- Toolbar -->
    <div class="flow-builder__toolbar">
      <span class="text-xs font-semibold text-(--ui-text-dimmed) uppercase tracking-wider mr-2">Add Node</span>
      <button v-for="nt in nodeTypeButtons" :key="nt.type" class="flow-builder__add-btn" :title="`Add ${nt.label}`" @click="addNode(nt.type)">
        <UIcon :name="nt.icon" class="size-3.5" />
        <span>{{ nt.label }}</span>
      </button>
      <div class="flex-1" />
      <span v-if="dirty" class="text-[10px] text-(--ui-warning) font-medium">Unsaved changes</span>
    </div>

    <!-- Canvas -->
    <div class="flow-builder__canvas">
      <VueFlow
        v-model:nodes="nodes"
        v-model:edges="edges"
        :default-viewport="{ x: 100, y: 50, zoom: 0.85 }"
        :snap-to-grid="true"
        :snap-grid="[20, 20]"
        :min-zoom="0.2"
        :max-zoom="2"
        :fit-view-on-init="true"
        :nodes-draggable="true"
        :nodes-connectable="true"
        :edges-updatable="true"
        :delete-key-code="null"
        @connect="onConnect"
        @nodes-change="onNodesChange"
        @edges-change="onEdgesChange"
        @keydown.delete="handleDeleteKey"
        @pane-context-menu="onPaneContextMenu"
        @pane-click="closeContextMenu"
        @move-start="closeContextMenu"
      >
        <template #node-message="nodeProps">
          <FlowNodeMessage :data="nodeProps.data" />
        </template>
        <template #node-menu="nodeProps">
          <FlowNodeMenu :data="nodeProps.data" />
        </template>
        <template #node-transfer="nodeProps">
          <FlowNodeTransfer :data="nodeProps.data" />
        </template>
        <template #node-hangup="nodeProps">
          <FlowNodeHangup :data="nodeProps.data" />
        </template>
        <template #node-collect="nodeProps">
          <FlowNodeCollect :data="nodeProps.data" :node-id="nodeProps.id" />
        </template>
        <template #node-condition="nodeProps">
          <FlowNodeCondition :data="nodeProps.data" :node-id="nodeProps.id" />
        </template>
        <template #node-http_request="nodeProps">
          <FlowNodeHttpRequest :data="nodeProps.data" :node-id="nodeProps.id" />
        </template>
        <template #node-set_variable="nodeProps">
          <FlowNodeSetVariable :data="nodeProps.data" :node-id="nodeProps.id" />
        </template>
        <template #node-trigger="nodeProps">
          <FlowNodeTrigger :data="nodeProps.data" />
        </template>
        <Background :gap="20" :size="1" pattern-color="var(--ui-text-dimmed)" :style="{ opacity: 0.15 }" />
        <Controls position="bottom-right" :show-interactive="false" />
      </VueFlow>

      <!-- Right-click context menu -->
      <Teleport to="body">
        <transition name="ctx-fade">
          <div v-if="contextMenu" class="flow-context-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @contextmenu.prevent>
            <div class="flow-context-menu__backdrop" @click="closeContextMenu" />
            <div class="flow-context-menu__panel">
              <div class="flow-context-menu__header">Add Node</div>
              <button
                v-for="nt in nodeTypeButtons"
                :key="nt.type"
                class="flow-context-menu__item"
                @click="addNodeAtPosition(nt.type)"
              >
                <UIcon :name="nt.icon" class="size-3.5 shrink-0" />
                <span>{{ nt.label }}</span>
              </button>
            </div>
          </div>
        </transition>
      </Teleport>
    </div>

    <!-- Delete confirmation dialog -->
    <transition name="fade">
      <div v-if="deleteConfirm" class="flow-builder__confirm-overlay" @click.self="cancelDelete">
        <div class="flow-builder__confirm-dialog">
          <p class="text-sm font-semibold text-(--ui-text-highlighted) mb-1">Delete node?</p>
          <p class="text-xs text-(--ui-text-muted) mb-3">
            "{{ deleteConfirm.label }}" has {{ deleteConfirm.edgeCount }} connection{{ deleteConfirm.edgeCount > 1 ? 's' : '' }}. This will remove the node and all its connections.
          </p>
          <div class="flex justify-end gap-2">
            <button class="flow-builder__confirm-btn flow-builder__confirm-btn--cancel" @click="cancelDelete">Cancel</button>
            <button class="flow-builder__confirm-btn flow-builder__confirm-btn--delete" @click="confirmDelete">Delete</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Validation warnings panel -->
    <transition name="fade">
      <div v-if="validationWarnings.length > 0" class="flow-builder__warnings">
        <div class="flow-builder__warnings-header">
          <UIcon name="i-lucide-alert-triangle" class="size-3.5" />
          <span>{{ validationWarnings.length }} warning{{ validationWarnings.length > 1 ? 's' : '' }}</span>
          <button class="flow-builder__warnings-close" @click="validationWarnings = []">×</button>
        </div>
        <ul class="flow-builder__warnings-list">
          <li v-for="(w, i) in validationWarnings" :key="i">{{ w }}</li>
        </ul>
      </div>
    </transition>

    <!-- Save feedback -->
    <transition name="fade">
      <div v-if="feedbackMsg" class="flow-builder__feedback" :class="feedbackError ? 'flow-builder__feedback--error' : ''">
        <UIcon :name="feedbackError ? 'i-lucide-alert-circle' : 'i-lucide-check-circle'" class="size-3.5" />
        {{ feedbackMsg }}
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { VueFlow, useVueFlow } from '@vue-flow/core';
import type { Node, Edge, Connection, NodeChange, EdgeChange } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import '@vue-flow/controls/dist/style.css';

import FlowNodeMessage from './flow-nodes/FlowNodeMessage.vue';
import FlowNodeMenu from './flow-nodes/FlowNodeMenu.vue';
import FlowNodeTransfer from './flow-nodes/FlowNodeTransfer.vue';
import FlowNodeHangup from './flow-nodes/FlowNodeHangup.vue';
import FlowNodeCollect from './flow-nodes/FlowNodeCollect.vue';
import FlowNodeCondition from './flow-nodes/FlowNodeCondition.vue';
import FlowNodeHttpRequest from './flow-nodes/FlowNodeHttpRequest.vue';
import FlowNodeSetVariable from './flow-nodes/FlowNodeSetVariable.vue';
import FlowNodeTrigger from './flow-nodes/FlowNodeTrigger.vue';

const props = defineProps<{ slug: string }>();

const nodeTypeButtons = [
  { type: 'message', label: 'Message', icon: 'i-lucide-message-circle' },
  { type: 'menu', label: 'Menu', icon: 'i-lucide-list' },
  { type: 'collect', label: 'Collect', icon: 'i-lucide-mic' },
  { type: 'condition', label: 'Condition', icon: 'i-lucide-git-branch' },
  { type: 'http_request', label: 'HTTP', icon: 'i-lucide-globe' },
  { type: 'set_variable', label: 'Set Var', icon: 'i-lucide-variable' },
  { type: 'transfer', label: 'Transfer', icon: 'i-lucide-phone-forwarded' },
  { type: 'hangup', label: 'Hangup', icon: 'i-lucide-phone-off' },
];

const nodes = ref<Node[]>([]);
const edges = ref<Edge[]>([]);
const startNodeId = ref('');
const saving = ref(false);
const dirty = ref(false);
const feedbackMsg = ref('');
const feedbackError = ref(false);
const validationWarnings = ref<string[]>([]);
const deleteConfirm = ref<{ nodeId: string; label: string; edgeCount: number } | null>(null);

// ── Right-click context menu ──
const contextMenu = ref<{ x: number; y: number; flowX: number; flowY: number } | null>(null);
const { screenToFlowCoordinate } = useVueFlow();

function onPaneContextMenu(event: MouseEvent) {
  event.preventDefault();
  const flowPos = screenToFlowCoordinate({ x: event.clientX, y: event.clientY });
  contextMenu.value = { x: event.clientX, y: event.clientY, flowX: flowPos.x, flowY: flowPos.y };
}

function addNodeAtPosition(type: string) {
  if (!contextMenu.value) return;
  const { flowX, flowY } = contextMenu.value;
  contextMenu.value = null;
  addNodeAt(type, flowX, flowY);
}

function closeContextMenu() {
  contextMenu.value = null;
}

// ── Provide available variables to child nodes ──
interface FlowVariable { name: string; source: string; builtin: boolean; }

/** Walk backwards through edges to find all ancestor node IDs */
function getUpstreamNodeIds(nodeId: string): Set<string> {
  const upstream = new Set<string>();
  const queue = [nodeId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of edges.value) {
      if (edge.target === current && !upstream.has(edge.source)) {
        upstream.add(edge.source);
        queue.push(edge.source);
      }
    }
  }
  return upstream;
}

function getAvailableVariables(nodeId?: string): FlowVariable[] {
  const vars: FlowVariable[] = [
    { name: 'caller', source: 'caller ID', builtin: true },
    { name: 'extension', source: 'dialed ext', builtin: true },
    { name: 'date', source: 'current date', builtin: true },
    { name: 'time', source: 'current time', builtin: true },
    { name: 'timestamp', source: 'ISO timestamp', builtin: true },
    { name: 'digit', source: 'last DTMF', builtin: true },
  ];
  const seen = new Set(vars.map((v) => v.name));

  // Only include variables from upstream nodes (reachable at runtime)
  const upstream = nodeId ? getUpstreamNodeIds(nodeId) : null;

  for (const node of nodes.value) {
    if (upstream && !upstream.has(node.id)) continue;

    const d = node.data as any;
    if (node.type === 'collect' && d.variable && !seen.has(d.variable)) {
      vars.push({ name: d.variable, source: d.label || 'Collect', builtin: false });
      seen.add(d.variable);
    }
    if (node.type === 'set_variable' && d.variable && !seen.has(d.variable)) {
      vars.push({ name: d.variable, source: d.label || 'Set Variable', builtin: false });
      seen.add(d.variable);
    }
    if (node.type === 'http_request' && d.resultVariable && !seen.has(d.resultVariable)) {
      vars.push({ name: d.resultVariable, source: d.label || 'HTTP Request', builtin: false });
      seen.add(d.resultVariable);
    }
  }
  return vars;
}

provide('flowVariables', getAvailableVariables);

let nodeIdCounter = 0;

function genId(): string {
  nodeIdCounter++;
  return `node_${nodeIdCounter}_${Date.now().toString(36)}`;
}

// ── Load flow from API ──
async function loadFlow() {
  try {
    const data: any = await $fetch(`/api/assistants/${props.slug}/flow`);
    flowToCanvas(data);
    dirty.value = false;
  } catch (e) {
    console.error('Failed to load flow:', e);
  }
}

// ── flow.json → canvas nodes + edges ──
function flowToCanvas(flow: any) {
  const newNodes: Node[] = [];
  const newEdges: Edge[] = [];
  startNodeId.value = flow.startNode || '';

  if (!flow.nodes) flow.nodes = {};

  // Ensure a trigger node exists (find existing or create)
  let triggerNodeId = '';
  for (const [id, node] of Object.entries<any>(flow.nodes)) {
    if (node.type === 'trigger') { triggerNodeId = id; break; }
  }
  if (!triggerNodeId) {
    triggerNodeId = '__trigger__';
    // Find leftmost/topmost node position to place trigger above it
    const positions = Object.values<any>(flow.nodes).map((n: any) => n.position).filter(Boolean);
    const minX = positions.length ? Math.min(...positions.map((p: any) => p.x)) : 250;
    const minY = positions.length ? Math.min(...positions.map((p: any) => p.y)) - 160 : 50;
    newNodes.push({
      id: triggerNodeId,
      type: 'trigger',
      position: { x: minX, y: minY },
      data: { label: 'Call Start', _slug: props.slug },
      deletable: false,
    });
    // Connect trigger → startNode
    if (flow.startNode && flow.nodes[flow.startNode]) {
      newEdges.push({
        id: `e-trigger-next`,
        source: triggerNodeId,
        target: flow.startNode,
        sourceHandle: 'next',
        animated: false,
      });
    }
  }

  for (const [id, node] of Object.entries<any>(flow.nodes)) {
    const pos = node.position || { x: 250, y: newNodes.length * 180 };
    const data: any = {
      label: node.label || id,
      audio: node.audio || '',
      text: node.text || '',
      isStart: id === flow.startNode,
      _slug: props.slug,
    };

    if (node.type === 'menu') {
      data.options = node.options || {};
      data.timeout = node.timeout || { seconds: 10, retries: 3 };
    }
    if (node.type === 'transfer') {
      data.extension = node.extension || '';
    }
    if (node.type === 'collect') {
      data.variable = node.variable || '';
    }
    if (node.type === 'condition') {
      data.variable = node.variable || '';
      data.operator = node.operator || 'equals';
      data.compareValue = node.compareValue || '';
    }
    if (node.type === 'http_request') {
      data.method = node.method || 'GET';
      data.url = node.url || '';
      data.headersJson = node.headersJson || '';
      data.bodyJson = node.bodyJson || '';
      data.resultVariable = node.resultVariable || '';
      // Error edge
      if (node.errorNext && flow.nodes[node.errorNext]) {
        newEdges.push({
          id: `e-${id}-error`,
          source: id,
          target: node.errorNext,
          sourceHandle: 'error',
          label: 'error',
          style: { stroke: '#ef4444', strokeDasharray: '5 5' },
          animated: false,
        });
      }
    }
    if (node.type === 'set_variable') {
      data.variable = node.variable || '';
      data.value = node.value || '';
    }

    newNodes.push({
      id,
      type: node.type,
      position: pos,
      data,
      ...(node.type === 'trigger' ? { deletable: false } : {}),
    });

    // Create edges for next/options (skip terminal nodes that have no output handle)
    if (node.next && flow.nodes[node.next] && !['transfer', 'hangup', 'menu'].includes(node.type)) {
      newEdges.push({
        id: `e-${id}-next`,
        source: id,
        target: node.next,
        sourceHandle: 'next',
        animated: false,
      });
    }
    if (node.options) {
      for (const [key, target] of Object.entries<string>(node.options)) {
        if (target && flow.nodes[target]) {
          newEdges.push({
            id: `e-${id}-opt-${key}`,
            source: id,
            target,
            sourceHandle: `opt-${key}`,
            label: key,
            animated: false,
          });
        }
      }
    }
    if (node.type === 'menu' && node.timeout?.next && flow.nodes[node.timeout.next]) {
      newEdges.push({
        id: `e-${id}-timeout`,
        source: id,
        target: node.timeout.next,
        sourceHandle: 'timeout',
        label: 'timeout',
        style: { strokeDasharray: '5 5' },
        animated: false,
      });
    }
    if (node.type === 'condition') {
      if (node.trueNext && flow.nodes[node.trueNext]) {
        newEdges.push({
          id: `e-${id}-true`,
          source: id,
          target: node.trueNext,
          sourceHandle: 'true',
          label: 'true',
          style: { stroke: '#22c55e' },
          animated: false,
        });
      }
      if (node.falseNext && flow.nodes[node.falseNext]) {
        newEdges.push({
          id: `e-${id}-false`,
          source: id,
          target: node.falseNext,
          sourceHandle: 'false',
          label: 'false',
          style: { stroke: '#ef4444' },
          animated: false,
        });
      }
    }

    // Track ID counter
    const numMatch = id.match(/^node_(\d+)/);
    if (numMatch && numMatch[1]) {
      nodeIdCounter = Math.max(nodeIdCounter, parseInt(numMatch[1]));
    }
  }

  nodes.value = newNodes;
  edges.value = newEdges;
}

// ── canvas → flow.json ──
function canvasToFlow(): any {
  // Derive startNode from trigger's outgoing edge
  const triggerNode = nodes.value.find((n) => n.type === 'trigger');
  let derivedStart = '';
  if (triggerNode) {
    const triggerEdge = edges.value.find(
      (e) => e.source === triggerNode.id && e.sourceHandle === 'next'
    );
    if (triggerEdge) derivedStart = triggerEdge.target;
  }

  const flow: any = {
    startNode: derivedStart || startNodeId.value,
    nodes: {},
  };

  for (const node of nodes.value) {
    // Store trigger node position but skip from runtime nodes
    if (node.type === 'trigger') {
      flow.nodes[node.id] = {
        type: 'trigger',
        label: 'Call Start',
        position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
      };
      continue;
    }

    const d = node.data as any;
    const flowNode: any = {
      type: node.type,
      label: d.label || node.id,
      position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
    };

    if (d.audio) flowNode.audio = d.audio;
    if (d.text) flowNode.text = d.text;

    if (['message', 'collect', 'http_request', 'set_variable'].includes(node.type!)) {
      const nextEdge = edges.value.find(
        (e) => e.source === node.id && e.sourceHandle === 'next'
      );
      if (nextEdge) flowNode.next = nextEdge.target;
    }

    if (node.type === 'collect' && d.variable) {
      flowNode.variable = d.variable;
    }

    if (node.type === 'transfer') {
      flowNode.extension = d.extension || '200';
    }

    if (node.type === 'condition') {
      flowNode.variable = d.variable || '';
      flowNode.operator = d.operator || 'equals';
      if (d.compareValue) flowNode.compareValue = d.compareValue;
      const trueEdge = edges.value.find(
        (e) => e.source === node.id && e.sourceHandle === 'true'
      );
      const falseEdge = edges.value.find(
        (e) => e.source === node.id && e.sourceHandle === 'false'
      );
      if (trueEdge) flowNode.trueNext = trueEdge.target;
      if (falseEdge) flowNode.falseNext = falseEdge.target;
    }

    if (node.type === 'http_request') {
      flowNode.method = d.method || 'GET';
      if (d.url) flowNode.url = d.url;
      if (d.headersJson) flowNode.headersJson = d.headersJson;
      if (d.bodyJson) flowNode.bodyJson = d.bodyJson;
      if (d.resultVariable) flowNode.resultVariable = d.resultVariable;
      const errorEdge = edges.value.find(
        (e) => e.source === node.id && e.sourceHandle === 'error'
      );
      if (errorEdge) flowNode.errorNext = errorEdge.target;
    }

    if (node.type === 'set_variable') {
      flowNode.variable = d.variable || '';
      flowNode.value = d.value || '';
    }

    if (node.type === 'menu') {
      // Build options from edges
      const options: Record<string, string> = {};
      for (const edge of edges.value) {
        if (edge.source !== node.id) continue;
        if (edge.sourceHandle?.startsWith('opt-')) {
          const key = edge.sourceHandle.replace('opt-', '');
          options[key] = edge.target;
        }
      }
      flowNode.options = options;

      // Timeout
      const timeout: any = {
        seconds: d.timeout?.seconds || 10,
        retries: d.timeout?.retries || 3,
      };
      const timeoutEdge = edges.value.find(
        (e) => e.source === node.id && e.sourceHandle === 'timeout'
      );
      if (timeoutEdge) timeout.next = timeoutEdge.target;
      flowNode.timeout = timeout;
    }

    flow.nodes[node.id] = flowNode;
  }

  // Auto-assign startNode if trigger isn't connected
  if (!flow.startNode) {
    const firstNonTrigger = nodes.value.find((n) => n.type !== 'trigger');
    if (firstNonTrigger) {
      flow.startNode = firstNonTrigger.id;
    }
  }

  return flow;
}

// ── Flow validation ──
function validateFlow(): string[] {
  const warnings: string[] = [];
  const triggerNode = nodes.value.find((n) => n.type === 'trigger');

  // Check trigger has outgoing connection
  if (triggerNode) {
    const triggerEdge = edges.value.find((e) => e.source === triggerNode.id);
    if (!triggerEdge) {
      warnings.push('Trigger node is not connected to any node');
    }
  }

  // Build sets for quick lookup
  const nodeIds = new Set(nodes.value.map((n) => n.id));
  const nodesWithIncoming = new Set(edges.value.map((e) => e.target));

  for (const node of nodes.value) {
    if (node.type === 'trigger') continue;
    const d = node.data as any;
    const label = d.label || node.id;

    // Unreachable: no incoming edges
    if (!nodesWithIncoming.has(node.id)) {
      warnings.push(`"${label}" has no incoming connection (unreachable)`);
    }

    // Type-specific validations
    if (node.type === 'transfer') {
      if (!d.extension) warnings.push(`"${label}" (Transfer) has no extension`);
    }
    if (node.type === 'menu') {
      const optKeys = Object.keys(d.options || {});
      if (optKeys.length === 0) warnings.push(`"${label}" (Menu) has no DTMF options`);
      // Check if any option is connected
      const connectedOpts = edges.value.filter(
        (e) => e.source === node.id && e.sourceHandle?.startsWith('opt-')
      );
      if (optKeys.length > 0 && connectedOpts.length === 0) {
        warnings.push(`"${label}" (Menu) — none of the DTMF options are connected`);
      }
    }
    if (node.type === 'collect') {
      if (!d.variable) warnings.push(`"${label}" (Collect) has no variable name`);
    }
    if (node.type === 'http_request') {
      if (!d.url) warnings.push(`"${label}" (HTTP) has no URL`);
    }
    if (node.type === 'message') {
      if (!d.audio && !d.text) warnings.push(`"${label}" (Message) has no audio or text`);
    }
    if (node.type === 'condition') {
      if (!d.variable) warnings.push(`"${label}" (Condition) has no variable`);
    }

    // Dead-end check: non-terminal nodes without outgoing edges
    const terminalTypes = ['transfer', 'hangup'];
    if (!terminalTypes.includes(node.type!)) {
      const hasOutgoing = edges.value.some((e) => e.source === node.id);
      if (!hasOutgoing) {
        warnings.push(`"${label}" (${node.type}) has no outgoing connection (dead-end)`);
      }
    }
  }

  return warnings;
}

// ── Save flow ──
async function saveFlow() {
  saving.value = true;
  feedbackMsg.value = '';
  feedbackError.value = false;
  validationWarnings.value = [];

  // Run validation
  const warnings = validateFlow();
  validationWarnings.value = warnings;

  try {
    const flow = canvasToFlow();
    await $fetch(`/api/assistants/${props.slug}/flow`, {
      method: 'PUT',
      body: flow,
    });
    dirty.value = false;
    if (warnings.length > 0) {
      feedbackMsg.value = `Saved with ${warnings.length} warning${warnings.length > 1 ? 's' : ''}`;
      feedbackError.value = false;
    } else {
      feedbackMsg.value = 'Flow saved';
      feedbackError.value = false;
    }
  } catch (e: any) {
    feedbackMsg.value = e.data?.message || 'Failed to save';
    feedbackError.value = true;
  } finally {
    saving.value = false;
    setTimeout(() => { feedbackMsg.value = ''; }, 5000);
  }
}

// ── Ensure trigger node exists ──
function ensureTrigger(): void {
  const hasTrigger = nodes.value.some((n) => n.type === 'trigger');
  if (!hasTrigger) {
    nodes.value = [
      {
        id: '__trigger__',
        type: 'trigger',
        position: { x: 250, y: 50 },
        data: { label: 'Call Start', _slug: props.slug },
        deletable: false,
      },
      ...nodes.value,
    ];
  }
}

// ── Add node ──
function addNode(type: string) {
  const x = 250 + Math.random() * 100;
  const y = 100 + nodes.value.length * 160;
  addNodeAt(type, x, y);
}

function addNodeAt(type: string, x: number, y: number) {
  ensureTrigger();

  const id = genId();
  const hasTriggerOnly = nodes.value.length === 1 && nodes.value[0]?.type === 'trigger';
  const data: any = {
    label: type.charAt(0).toUpperCase() + type.slice(1),
    audio: '',
    text: '',
    _slug: props.slug,
  };

  if (type === 'menu') {
    data.options = { '1': '', '2': '' };
    data.timeout = { seconds: 10, retries: 3 };
  }
  if (type === 'transfer') {
    data.extension = '200';
  }
  if (type === 'collect') {
    data.variable = 'input';
  }
  if (type === 'condition') {
    data.variable = '';
    data.operator = 'equals';
    data.compareValue = '';
    data.label = 'Condition';
  }
  if (type === 'http_request') {
    data.method = 'GET';
    data.url = '';
    data.headersJson = '';
    data.bodyJson = '';
    data.resultVariable = '';
    data.label = 'HTTP Request';
  }
  if (type === 'set_variable') {
    data.variable = '';
    data.value = '';
    data.label = 'Set Variable';
  }

  // Snap to grid
  const snappedX = Math.round(x / 20) * 20;
  const snappedY = Math.round(y / 20) * 20;

  nodes.value = [
    ...nodes.value,
    { id, type, position: { x: snappedX, y: snappedY }, data },
  ];

  // Auto-connect trigger → first added node
  if (hasTriggerOnly) {
    edges.value = [
      ...edges.value,
      {
        id: 'e-trigger-next',
        source: '__trigger__',
        target: id,
        sourceHandle: 'next',
        animated: false,
      } as Edge,
    ];
  }

  dirty.value = true;
}

// ── Connection handling ──
function onConnect(connection: Connection) {
  const id = `e-${connection.source}-${connection.sourceHandle || 'next'}`;
  // Remove existing edge from same source handle (1:1 per handle)
  edges.value = edges.value.filter(
    (e) => !(e.source === connection.source && e.sourceHandle === connection.sourceHandle)
  );
  edges.value = [
    ...edges.value,
    {
      id,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
      label: connection.sourceHandle?.startsWith('opt-')
        ? connection.sourceHandle.replace('opt-', '')
        : connection.sourceHandle === 'timeout'
          ? 'timeout'
          : connection.sourceHandle === 'true'
            ? 'true'
            : connection.sourceHandle === 'false'
              ? 'false'
              : connection.sourceHandle === 'error'
                ? 'error'
                : undefined,
      style: connection.sourceHandle === 'timeout'
        ? { strokeDasharray: '5 5' }
        : connection.sourceHandle === 'true'
          ? { stroke: '#22c55e' }
          : connection.sourceHandle === 'false'
            ? { stroke: '#ef4444' }
            : connection.sourceHandle === 'error'
              ? { stroke: '#ef4444', strokeDasharray: '5 5' }
              : undefined,
      animated: false,
    } as Edge,
  ];
  dirty.value = true;
}

const pendingDeletes = ref<string[]>([]);

function handleDeleteKey() {
  // Find selected nodes (vue-flow marks them with .selected)
  const selectedNodes = nodes.value.filter((n) => (n as any).selected && n.type !== 'trigger');
  if (selectedNodes.length === 0) {
    // Maybe edges are selected — let those be deleted
    edges.value = edges.value.filter((e) => !(e as any).selected);
    dirty.value = true;
    return;
  }

  // Delete unconnected nodes immediately, queue connected ones for confirmation
  const needConfirm: Node[] = [];
  for (const node of selectedNodes) {
    const connectedEdges = edges.value.filter(
      (e) => e.source === node.id || e.target === node.id
    );
    if (connectedEdges.length > 0) {
      needConfirm.push(node);
    } else {
      nodes.value = nodes.value.filter((n) => n.id !== node.id);
      dirty.value = true;
    }
  }

  // Show confirmation for connected nodes (one at a time, rest queued)
  if (needConfirm.length > 0) {
    pendingDeletes.value = needConfirm.slice(1).map((n) => n.id);
    const first = needConfirm[0]!;
    const edgeCount = edges.value.filter(
      (e) => e.source === first.id || e.target === first.id
    ).length;
    deleteConfirm.value = {
      nodeId: first.id,
      label: (first.data as any)?.label || first.id,
      edgeCount,
    };
  }
}

function confirmDelete() {
  if (!deleteConfirm.value) return;
  const nodeId = deleteConfirm.value.nodeId;
  edges.value = edges.value.filter(
    (e) => e.source !== nodeId && e.target !== nodeId
  );
  nodes.value = nodes.value.filter((n) => n.id !== nodeId);
  dirty.value = true;

  // Process next queued node
  if (pendingDeletes.value.length > 0) {
    const nextId = pendingDeletes.value.shift()!;
    const nextNode = nodes.value.find((n) => n.id === nextId);
    if (nextNode) {
      const edgeCount = edges.value.filter(
        (e) => e.source === nextId || e.target === nextId
      ).length;
      if (edgeCount > 0) {
        deleteConfirm.value = {
          nodeId: nextId,
          label: (nextNode.data as any)?.label || nextId,
          edgeCount,
        };
        return;
      }
      // No edges left (removed by prior deletion) — delete silently
      nodes.value = nodes.value.filter((n) => n.id !== nextId);
    }
  }
  deleteConfirm.value = null;
}

function cancelDelete() {
  deleteConfirm.value = null;
  pendingDeletes.value = [];
}

function onNodesChange(_changes: NodeChange[]) {
  dirty.value = true;
}

function onEdgesChange(_changes: EdgeChange[]) {
  dirty.value = true;
}

// ── Watch slug for reloads ──
watch(() => props.slug, () => {
  loadFlow();
}, { immediate: true });

// Expose save for parent
defineExpose({ saveFlow, saving, dirty });
</script>

<style>
/* ── Flow Builder Layout ── */
.flow-builder {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
}

.flow-builder__toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--ui-bg-elevated);
  border-bottom: 1px solid var(--ui-border);
  flex-shrink: 0;
}

.flow-builder__add-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 6px;
  background: var(--ui-bg);
  border: 1px solid var(--ui-border);
  color: var(--ui-text);
  cursor: pointer;
  transition: all 0.15s;
}
.flow-builder__add-btn:hover {
  background: color-mix(in srgb, var(--ui-primary) 10%, var(--ui-bg));
  border-color: var(--ui-primary);
  color: var(--ui-primary);
}

.flow-builder__canvas {
  flex: 1;
  min-height: 0;
  position: relative;
}

.flow-builder__empty-hint {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.flow-builder__feedback {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  background: color-mix(in srgb, var(--ui-success) 15%, var(--ui-bg));
  color: var(--ui-success);
  border: 1px solid color-mix(in srgb, var(--ui-success) 30%, transparent);
  z-index: 10;
}
.flow-builder__feedback--error {
  background: color-mix(in srgb, var(--ui-error) 15%, var(--ui-bg));
  color: var(--ui-error);
  border-color: color-mix(in srgb, var(--ui-error) 30%, transparent);
}

/* ── Validation warnings ── */
.flow-builder__warnings {
  position: absolute;
  bottom: 48px;
  left: 50%;
  transform: translateX(-50%);
  min-width: 280px;
  max-width: 420px;
  background: color-mix(in srgb, var(--ui-warning) 8%, var(--ui-bg));
  border: 1px solid color-mix(in srgb, var(--ui-warning) 30%, transparent);
  border-radius: 8px;
  font-size: 11px;
  z-index: 10;
  box-shadow: 0 4px 12px rgba(0,0,0,.12);
}
.flow-builder__warnings-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-weight: 600;
  color: var(--ui-warning);
  border-bottom: 1px solid color-mix(in srgb, var(--ui-warning) 20%, transparent);
}
.flow-builder__warnings-close {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--ui-text-dimmed);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0 2px;
}
.flow-builder__warnings-close:hover { color: var(--ui-text); }
.flow-builder__warnings-list {
  list-style: none;
  margin: 0;
  padding: 6px 10px;
  max-height: 160px;
  overflow-y: auto;
}
.flow-builder__warnings-list li {
  padding: 2px 0;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.4;
}
.flow-builder__warnings-list li::before {
  content: '•';
  margin-right: 6px;
  color: var(--ui-warning);
}

/* ── Delete confirmation ── */
.flow-builder__confirm-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.flow-builder__confirm-dialog {
  background: var(--ui-bg);
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  padding: 16px 20px;
  min-width: 280px;
  box-shadow: 0 8px 24px rgba(0,0,0,.2);
}
.flow-builder__confirm-btn {
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
  border: 1px solid var(--ui-border);
  cursor: pointer;
  transition: all 0.15s;
}
.flow-builder__confirm-btn--cancel {
  background: var(--ui-bg);
  color: var(--ui-text);
}
.flow-builder__confirm-btn--cancel:hover {
  background: var(--ui-bg-elevated);
}
.flow-builder__confirm-btn--delete {
  background: var(--ui-error);
  color: white;
  border-color: var(--ui-error);
}
.flow-builder__confirm-btn--delete:hover {
  opacity: 0.9;
}

/* ── Flow Node Shared Styles ── */
.flow-node {
  min-width: 200px;
  max-width: 260px;
  background: var(--ui-bg);
  border: 1.5px solid var(--ui-border);
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(0,0,0,.08);
  overflow: visible;
  font-size: 12px;
}
.flow-node--start {
  border-color: color-mix(in srgb, var(--ui-success) 60%, var(--ui-border));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-success) 15%, transparent), 0 2px 8px rgba(0,0,0,.08);
}

.flow-node__header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--ui-border);
  background: var(--ui-bg-elevated);
  border-radius: 9px 9px 0 0;
}

.flow-node__label {
  flex: 1;
  font-size: 12px;
  font-weight: 600;
  background: transparent;
  border: none;
  outline: none;
  color: var(--ui-text-highlighted);
  min-width: 0;
}

.flow-node__badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}
.flow-node__badge--message { background: color-mix(in srgb, #22c55e 15%, transparent); color: #22c55e; }
.flow-node__badge--menu { background: color-mix(in srgb, #3b82f6 15%, transparent); color: #3b82f6; }
.flow-node__badge--transfer { background: color-mix(in srgb, #f59e0b 15%, transparent); color: #f59e0b; }
.flow-node__badge--hangup { background: color-mix(in srgb, #ef4444 15%, transparent); color: #ef4444; }
.flow-node__badge--collect { background: color-mix(in srgb, #a855f7 15%, transparent); color: #a855f7; }
.flow-node__badge--condition { background: color-mix(in srgb, #06b6d4 15%, transparent); color: #06b6d4; }
.flow-node__badge--http { background: color-mix(in srgb, #ec4899 15%, transparent); color: #ec4899; }
.flow-node__badge--set-variable { background: color-mix(in srgb, #8b5cf6 15%, transparent); color: #8b5cf6; }
.flow-node__badge--trigger { background: color-mix(in srgb, #10b981 15%, transparent); color: #10b981; }

.flow-node__body {
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.flow-node__textarea {
  width: 100%;
  font-size: 10px;
  padding: 4px 6px;
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  background: var(--ui-bg);
  color: var(--ui-text);
  resize: none;
  outline: none;
  font-family: inherit;
}
.flow-node__textarea:focus {
  border-color: var(--ui-primary);
}

.flow-node__text-input {
  flex: 1;
  font-size: 11px;
  padding: 2px 6px;
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  background: var(--ui-bg);
  color: var(--ui-text);
  outline: none;
  min-width: 0;
}
.flow-node__text-input:focus {
  border-color: var(--ui-primary);
}

.flow-node__num-input {
  width: 36px;
  font-size: 10px;
  padding: 1px 3px;
  border: 1px solid var(--ui-border);
  border-radius: 3px;
  background: var(--ui-bg);
  color: var(--ui-text);
  outline: none;
  text-align: center;
}

/* ── Menu node options ── */
.flow-node__options {
  border-top: 1px solid var(--ui-border);
  padding-top: 6px;
}
.flow-node__options-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.flow-node__option-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 3px;
  position: relative;
}
.flow-node__key-input {
  width: 22px;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
  padding: 1px;
  border: 1px solid var(--ui-border);
  border-radius: 3px;
  background: var(--ui-bg);
  color: var(--ui-primary);
  outline: none;
}
.flow-node__add-btn {
  font-size: 11px;
  font-weight: 700;
  color: var(--ui-primary);
  cursor: pointer;
  background: none;
  border: none;
  padding: 0 4px;
}
.flow-node__remove-btn {
  font-size: 13px;
  color: var(--ui-text-dimmed);
  cursor: pointer;
  background: none;
  border: none;
  padding: 0 2px;
  line-height: 1;
}
.flow-node__remove-btn:hover { color: var(--ui-error); }

.flow-node__timeout {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-top: 4px;
  border-top: 1px solid var(--ui-border);
}

.flow-node__select {
  font-size: 10px;
  padding: 2px 4px;
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  background: var(--ui-bg);
  color: var(--ui-text);
  outline: none;
}
.flow-node__select:focus {
  border-color: var(--ui-primary);
}

/* ── Node type border colors ── */
.flow-node--message { border-left: 3px solid #22c55e; }
.flow-node--menu { border-left: 3px solid #3b82f6; }
.flow-node--transfer { border-left: 3px solid #f59e0b; }
.flow-node--hangup { border-left: 3px solid #ef4444; }
.flow-node--collect { border-left: 3px solid #a855f7; }
.flow-node--condition { border-left: 3px solid #06b6d4; }
.flow-node--http { border-left: 3px solid #ec4899; }
.flow-node--set-variable { border-left: 3px solid #8b5cf6; }
.flow-node--trigger { border-left: 3px solid #10b981; border-top: 2px solid #10b981; }

/* ── Vue Flow overrides ── */
.vue-flow {
  height: 100%;
  background: var(--ui-bg);
}
.vue-flow__node {
  border: none !important;
  box-shadow: none !important;
  background: none !important;
  padding: 0 !important;
}
.vue-flow__edge-path {
  stroke: var(--ui-text-dimmed);
  stroke-width: 1.5;
}
.vue-flow__edge-textbg {
  fill: var(--ui-bg-elevated);
}
.vue-flow__edge-text {
  fill: var(--ui-text-muted);
  font-size: 10px;
}
.vue-flow__handle {
  width: 8px;
  height: 8px;
  background: var(--ui-primary);
  border: 2px solid var(--ui-bg);
}
.vue-flow__minimap {
  background: var(--ui-bg-elevated);
  border: 1px solid var(--ui-border);
  border-radius: 6px;
}
.vue-flow__controls {
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--ui-bg);
}
.vue-flow__controls button {
  background: var(--ui-bg);
  border-bottom: 1px solid var(--ui-border);
  color: var(--ui-text-muted);
  width: 28px;
  height: 28px;
}
.vue-flow__controls button:hover {
  background: var(--ui-bg-elevated);
  color: var(--ui-text);
}
.vue-flow__controls button svg {
  fill: currentColor;
}
.vue-flow__background {
  background: var(--ui-bg);
}

/* Transitions */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

/* Context menu */
.flow-context-menu {
  position: fixed;
  z-index: 9999;
}
.flow-context-menu__backdrop {
  position: fixed;
  inset: 0;
}
.flow-context-menu__panel {
  position: relative;
  min-width: 160px;
  background: var(--ui-bg-elevated);
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,.2);
  padding: 4px;
  overflow: hidden;
}
.flow-context-menu__header {
  padding: 6px 10px 4px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ui-text-dimmed);
}
.flow-context-menu__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 500;
  color: var(--ui-text);
  transition: background 0.1s;
  cursor: pointer;
  border: none;
  background: none;
  text-align: left;
}
.flow-context-menu__item:hover {
  background: var(--ui-primary);
  color: white;
}
.ctx-fade-enter-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.ctx-fade-leave-active {
  transition: opacity 0.08s ease;
}
.ctx-fade-enter-from {
  opacity: 0;
  transform: scale(0.95);
}
.ctx-fade-leave-to {
  opacity: 0;
}
</style>
