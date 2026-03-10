<template>
  <div class="h-[calc(100vh-160px)] flex flex-col space-y-3 relative overflow-x-hidden">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-(--ui-text-highlighted)">Terminal</h1>
        <p class="text-sm text-(--ui-text-muted)">
          <template v-if="activeTab?.connected">
            <span class="text-green-400">Connected</span>
            <span class="text-(--ui-text-dimmed)"> — {{ activeTab.label }}</span>
          </template>
          <template v-else-if="activeTab?.loading">
            <span class="text-yellow-400">Connecting...</span>
          </template>
          <template v-else>Interactive shell sessions</template>
        </p>
      </div>
      <div class="flex gap-2 items-center">
        <UButton
          icon="i-lucide-book-open"
          :variant="showCommands ? 'soft' : 'ghost'"
          :color="showCommands ? 'primary' : 'neutral'"
          size="sm"
          @click="showCommands = !showCommands"
          title="Command reference"
        />
        <UButton
          v-if="activeTab?.connected"
          label="Disconnect"
          icon="i-lucide-unplug"
          color="error"
          variant="soft"
          size="sm"
          @click="disconnectTab(activeTabId)"
        />
      </div>
    </div>

    <!-- Initializing Loader -->
    <div v-if="pageInitializing" class="flex-1 flex items-center justify-center">
      <div class="text-center space-y-4">
        <UIcon name="i-lucide-loader-2" class="w-12 h-12 animate-spin text-primary mx-auto" />
        <p class="text-sm text-muted-foreground">Checking SSH configuration...</p>
      </div>
    </div>

    <template v-else>
      <!-- Tab Bar -->
      <div class="flex items-center bg-(--ui-bg-elevated) p-1 rounded-lg overflow-x-auto">
        <div
          v-for="tab in tabs"
          :key="tab.id"
          class="group flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md cursor-pointer transition-all shrink-0 select-none"
          :class="tab.id === activeTabId ? 'bg-primary text-white shadow-sm' : 'text-(--ui-text-muted) hover:text-(--ui-text-highlighted) hover:bg-(--ui-bg-accented)'"
          @click="switchTab(tab.id)"
          @dblclick="startRenaming(tab.id)"
        >
          <span v-if="tab.connected" class="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0"></span>
          <span v-else-if="tab.loading" class="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse shrink-0"></span>
          <UIcon :name="tab.type === 'local' ? 'i-lucide-cpu' : 'i-lucide-globe'" class="w-3.5 h-3.5 shrink-0" />

          <input
            v-if="renamingTabId === tab.id"
            v-model="renameValue"
            :data-rename-tab="tab.id"
            class="bg-transparent border-b border-white/50 outline-none w-24 text-xs"
            @blur="finishRenaming"
            @keydown.enter="finishRenaming"
            @keydown.escape="cancelRenaming"
            @click.stop
          />
          <span v-else class="truncate max-w-[120px]">{{ tab.label }}</span>

          <button
            v-if="tabs.length > 1"
            class="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity ml-0.5"
            @click.stop="closeTab(tab.id)"
          >
            <UIcon name="i-lucide-x" class="w-3 h-3" />
          </button>
        </div>

        <!-- Add Tab Buttons -->
        <div class="flex items-center gap-0.5 ml-1 pl-1.5 border-l border-(--ui-border-muted) shrink-0">
          <button
            @click="addTab('remote')"
            class="flex items-center justify-center w-6 h-6 rounded text-(--ui-text-muted) hover:text-(--ui-text-highlighted) hover:bg-(--ui-bg-accented) transition-colors"
            title="New SSH session"
          >
            <UIcon name="i-lucide-globe" class="w-3.5 h-3.5" />
          </button>
          <button
            @click="addLocalTab()"
            class="flex items-center justify-center w-6 h-6 rounded text-(--ui-text-muted) hover:text-(--ui-text-highlighted) hover:bg-(--ui-bg-accented) transition-colors"
            title="New local session"
          >
            <UIcon name="i-lucide-cpu" class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <!-- SSH Connection Form (active remote tab, not yet started) -->
      <div v-if="activeTab && !activeTab.started && activeTab.type === 'remote'" class="flex-1 flex items-center justify-center p-4">
        <UCard class="w-full max-w-xl shadow-xl border-dashed border-2 border-(--ui-border-accentmed)">
          <template #header>
            <div class="flex items-center gap-3">
              <div class="p-2 rounded-lg bg-primary/10">
                <UIcon name="i-lucide-globe" class="w-6 h-6 text-primary" />
              </div>
              <div>
                <span class="font-bold text-lg">Connect to Server</span>
                <p class="text-xs text-muted-foreground">Access Asterisk PBX hardware</p>
              </div>
            </div>
          </template>

          <div class="space-y-6 py-4">
            <UAlert
              v-if="activeTab.error"
              color="error"
              variant="soft"
              :title="activeTab.error"
              icon="i-lucide-alert-circle"
            />

            <div class="flex items-center gap-6">
              <UFormField label="Host (IP Address)" class="flex-1">
                <UInput v-model="activeTab.sshConfig.host" placeholder="192.168.1.100" icon="i-lucide-network" class="w-full" />
              </UFormField>
              <UFormField label="Port" class="w-32">
                <UInput v-model="activeTab.sshConfig.port" placeholder="22" type="number" icon="i-lucide-hash" class="w-full" />
              </UFormField>
            </div>

            <p class="text-sm text-center text-muted-foreground italic px-4">
              If you leave credentials empty, you will be prompted securely inside the terminal session.
            </p>
          </div>

          <template #footer>
            <UButton
              block
              size="lg"
              label="Open Remote Terminal"
              icon="i-lucide-terminal"
              @click="startSession(activeTab.id)"
              :loading="activeTab.loading"
            />
          </template>
        </UCard>
      </div>

      <!-- Local confirmation (active local tab, not yet started) -->
      <div v-else-if="activeTab && !activeTab.started && activeTab.type === 'local'" class="flex-1 flex items-center justify-center p-4">
        <UCard class="w-full max-w-sm shadow-xl border-dashed border-2 border-(--ui-border-accentmed)">
          <template #header>
            <div class="flex items-center gap-3">
              <div class="p-2 rounded-lg bg-primary/10">
                <UIcon name="i-lucide-cpu" class="w-6 h-6 text-primary" />
              </div>
              <div>
                <span class="font-bold text-lg">Local Terminal</span>
                <p class="text-xs text-muted-foreground">Access dashboard server OS</p>
              </div>
            </div>
          </template>

          <div class="text-center py-4">
            <p class="text-muted-foreground text-sm">
              Open a local shell on the dashboard host.
            </p>
          </div>

          <template #footer>
            <UButton
              block
              size="lg"
              label="Open Local Terminal"
              icon="i-lucide-terminal"
              @click="startSession(activeTab.id)"
              :loading="activeTab.loading"
            />
          </template>
        </UCard>
      </div>

      <!-- Terminal Containers (all started tabs persist, only active visible) -->
      <UCard
        v-for="tab in startedTabs"
        :key="'term-' + tab.id"
        v-show="tab.id === activeTabId"
        class="flex-1 overflow-hidden"
        :ui="{ body: 'p-0 h-full' }"
      >
        <div :ref="(el: any) => setContainer(tab.id, el)" class="w-full h-full bg-black"></div>
      </UCard>

      <p v-if="activeTab && !activeTab.started" class="text-xs text-center text-(--ui-text-dimmed)">
        Tip: Credentials can be pre-configured in the <NuxtLink to="/config" class="text-(--ui-primary) hover:underline">Config</NuxtLink> page for automatic login.
      </p>
    </template>

    <!-- Command Reference Panel -->
    <Transition name="commands-panel">
      <div
        v-if="showCommands"
        class="absolute right-0 top-12 bottom-0 w-80 z-20 bg-(--ui-bg-elevated) border-l border-(--ui-border) shadow-xl flex flex-col"
      >
        <div class="shrink-0">
          <div class="px-3 py-2 border-b border-(--ui-border) flex items-center justify-between">
            <span class="text-sm font-semibold text-(--ui-text-highlighted)">Command Reference</span>
            <button @click="showCommands = false" class="text-(--ui-text-muted) hover:text-(--ui-text-highlighted)">
              <UIcon name="i-lucide-x" class="w-4 h-4" />
            </button>
          </div>
          <div class="px-2 py-2 border-b border-(--ui-border)">
            <div class="relative">
              <UIcon name="i-lucide-search" class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-(--ui-text-dimmed)" />
              <input
                v-model="cmdSearch"
                type="text"
                placeholder="Search commands..."
                class="w-full pl-8 pr-2 py-1.5 text-xs bg-(--ui-bg) border border-(--ui-border) rounded-md text-(--ui-text-highlighted) placeholder:text-(--ui-text-dimmed) focus:outline-none focus:ring-1 focus:ring-(--ui-primary)"
              />
            </div>
          </div>
        </div>

        <div class="overflow-y-auto p-2 space-y-3 flex-1">
          <template v-if="filteredCommandGroups.length === 0">
            <p class="text-xs text-(--ui-text-dimmed) text-center py-4">No commands match "{{ cmdSearch }}"</p>
          </template>
          <div v-for="group in filteredCommandGroups" :key="group.label">
            <div class="text-xs font-semibold text-(--ui-text-muted) uppercase tracking-wide px-2 py-1.5 flex items-center gap-1.5">
              <UIcon :name="group.icon" class="w-3.5 h-3.5" />
              {{ group.label }}
            </div>
            <div class="space-y-0.5">
              <button
                v-for="cmd in group.commands"
                :key="cmd.cmd"
                class="w-full text-left px-2 py-2 rounded text-sm hover:bg-(--ui-bg-accented) transition-colors"
                @click="insertCommand(cmd.cmd)"
                :title="'Insert: ' + cmd.cmd"
              >
                <code class="text-primary font-mono text-xs">{{ cmd.cmd }}</code>
                <p class="text-(--ui-text-dimmed) text-[11px] mt-0.5">{{ cmd.desc }}</p>
              </button>
            </div>
          </div>
        </div>

        <div class="px-3 py-2 border-t border-(--ui-border) text-[10px] text-(--ui-text-dimmed) shrink-0">
          Click a command to insert it into the active terminal.
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

const { on, off, emit, connected: socketConnected } = useSocket();

const pageInitializing = ref(true);
const renamingTabId = ref<string | null>(null);
const renameValue = ref('');
const showCommands = ref(false);
const cmdSearch = ref('');

const commandGroups = [
  {
    label: 'Asterisk CLI',
    icon: 'i-lucide-terminal',
    commands: [
      { cmd: 'asterisk -rvvv', desc: 'Connect to Asterisk console (verbose)' },
      { cmd: 'core show version', desc: 'Asterisk version info' },
      { cmd: 'core show uptime', desc: 'System uptime' },
      { cmd: 'core reload', desc: 'Reload all configuration' },
      { cmd: 'module show', desc: 'List all loaded modules' },
      { cmd: 'module reload', desc: 'Reload all modules' },
      { cmd: 'module reload res_ari.so', desc: 'Reload ARI module (fixes ARI after reboot)' },
      { cmd: 'module reload res_http_websocket.so', desc: 'Reload HTTP WebSocket module' },
      { cmd: 'logger reload', desc: 'Reload logging config' },
    ],
  },
  {
    label: 'ARI & HTTP',
    icon: 'i-lucide-cable',
    commands: [
      { cmd: 'ari show status', desc: 'ARI enabled status and app count' },
      { cmd: 'ari show users', desc: 'List ARI users and permissions' },
      { cmd: 'ari show apps', desc: 'List registered Stasis apps' },
      { cmd: 'ari show app stasis-app', desc: 'Show details for stasis-app' },
      { cmd: 'ari set debug all on', desc: 'Enable ARI debug logging' },
      { cmd: 'ari set debug all off', desc: 'Disable ARI debug logging' },
      { cmd: 'http show status', desc: 'HTTP server status and registered URIs' },
    ],
  },
  {
    label: 'Channels & Calls',
    icon: 'i-lucide-phone',
    commands: [
      { cmd: 'core show channels', desc: 'List active channels' },
      { cmd: 'core show calls', desc: 'Active calls count' },
      { cmd: 'core show channels concise', desc: 'Compact channel list' },
      { cmd: 'core show channel ', desc: 'Full detail for one channel (add name)' },
      { cmd: 'channel request hangup ', desc: 'Hangup a channel (add name)' },
      { cmd: 'core show bridges', desc: 'List active bridges' },
    ],
  },
  {
    label: 'PJSIP',
    icon: 'i-lucide-wifi',
    commands: [
      { cmd: 'pjsip show endpoints', desc: 'List all SIP endpoints' },
      { cmd: 'pjsip show registrations', desc: 'Outbound registration status' },
      { cmd: 'pjsip show contacts', desc: 'Active SIP contacts' },
      { cmd: 'pjsip show aors', desc: 'Address of records' },
      { cmd: 'pjsip show endpoint ', desc: 'Endpoint details (add name)' },
      { cmd: 'pjsip show channelstats', desc: 'RTP stats for active channels' },
      { cmd: 'pjsip qualify ', desc: 'Send OPTIONS ping (add endpoint)' },
    ],
  },
  {
    label: 'Dialplan',
    icon: 'i-lucide-git-branch',
    commands: [
      { cmd: 'dialplan show', desc: 'Show full dialplan' },
      { cmd: 'dialplan show stasis-app', desc: 'Show stasis-app context' },
      { cmd: 'dialplan show from-trunk-custom', desc: 'Show trunk routing context' },
      { cmd: 'dialplan reload', desc: 'Reload dialplan' },
      { cmd: 'core show applications', desc: 'List all dialplan apps' },
      { cmd: 'core show application Stasis', desc: 'Show Stasis app usage' },
    ],
  },
  {
    label: 'FreePBX / fwconsole',
    icon: 'i-lucide-settings',
    commands: [
      { cmd: 'sudo fwconsole reload', desc: 'Apply config changes (like GUI Apply)' },
      { cmd: 'sudo fwconsole restart', desc: 'Restart FreePBX + Asterisk' },
      { cmd: 'sudo fwconsole ma list', desc: 'List all installed modules' },
      { cmd: 'sudo fwconsole ma downloadinstall arimanager', desc: 'Install ARI manager module' },
      { cmd: 'sudo fwconsole ma enable arimanager', desc: 'Enable ARI manager module' },
      { cmd: 'sudo fwconsole ma upgrade --all', desc: 'Upgrade all FreePBX modules' },
      { cmd: 'sudo fwconsole setting FPBX_ARI_PASSWORD', desc: 'Show current ARI password' },
      { cmd: 'sudo fwconsole chown', desc: 'Fix file ownership & permissions' },
      { cmd: 'sudo fwconsole --list', desc: 'Show all fwconsole commands' },
    ],
  },
  {
    label: 'System',
    icon: 'i-lucide-server',
    commands: [
      { cmd: 'systemctl status asterisk', desc: 'Asterisk service status' },
      { cmd: 'systemctl status httpd', desc: 'Apache (FreePBX web) status' },
      { cmd: 'systemctl restart asterisk', desc: 'Restart Asterisk service' },
      { cmd: 'tail -f /var/log/asterisk/full', desc: 'Watch live Asterisk logs' },
      { cmd: 'df -h', desc: 'Disk usage' },
      { cmd: 'free -h', desc: 'Memory usage' },
      { cmd: 'top -bn1 | head -20', desc: 'CPU / process snapshot' },
      { cmd: 'ss -tlnp', desc: 'Listening TCP ports and processes' },
      { cmd: 'ss -ulnp | grep 5060', desc: 'Check SIP port binding' },
    ],
  },
  {
    label: 'Audio & Files',
    icon: 'i-lucide-music',
    commands: [
      { cmd: 'ls /var/lib/asterisk/sounds/custom/', desc: 'Custom sound files' },
      { cmd: 'ls /var/spool/asterisk/monitor/', desc: 'Call recordings' },
      { cmd: 'ls /var/lib/asterisk/moh/', desc: 'Music on hold files' },
      { cmd: 'core show sounds', desc: 'Registered sound files (Asterisk CLI)' },
      { cmd: 'moh show classes', desc: 'Music on hold classes (Asterisk CLI)' },
    ],
  },
  {
    label: 'Firewall & Security',
    icon: 'i-lucide-shield',
    commands: [
      { cmd: 'sudo fwconsole firewall list', desc: 'List firewall rules' },
      { cmd: 'sudo fwconsole firewall trust ', desc: 'Trust an IP (add address)' },
      { cmd: 'sudo fwconsole firewall f2bs', desc: 'Show fail2ban status' },
      { cmd: 'sudo fwconsole firewall restart', desc: 'Restart firewall' },
      { cmd: 'sudo iptables -L -n', desc: 'List all iptables rules' },
      { cmd: 'sudo iptables -D fail2ban-SIP 1', desc: 'Unban first SIP entry' },
      { cmd: 'sudo iptables -D fail2ban-PBX-GUI 1', desc: 'Unban first GUI entry' },
      { cmd: 'sudo fail2ban-client status', desc: 'Fail2ban jail status' },
    ],
  },
  {
    label: 'Database & AMI',
    icon: 'i-lucide-database',
    commands: [
      { cmd: 'database show', desc: 'Show all AstDB entries' },
      { cmd: 'database show cidname', desc: 'Caller ID name cache' },
      { cmd: 'manager show users', desc: 'List AMI users' },
      { cmd: 'manager show connected', desc: 'Currently connected AMI sessions' },
    ],
  },
];

const filteredCommandGroups = computed(() => {
  const q = cmdSearch.value.toLowerCase().trim();
  if (!q) return commandGroups;
  return commandGroups
    .map(g => ({
      ...g,
      commands: g.commands.filter(c =>
        c.cmd.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q)
      ),
    }))
    .filter(g => g.commands.length > 0);
});

interface TabSession {
  id: string;
  type: 'remote' | 'local';
  label: string;
  terminal: Terminal | null;
  fitAddon: FitAddon | null;
  connected: boolean;
  started: boolean;
  loading: boolean;
  error: string | null;
  authMode: 'none' | 'username' | 'password';
  authBuffer: string;
  sshConfig: { host: string; port: string; username: string; password: string };
}

const tabs = reactive<TabSession[]>([]);
const activeTabId = ref('');
let tabCounter = 0;

// Remembered from env — pre-fills new SSH tabs
const defaultSsh = reactive({ host: '', port: '22', username: '' });

const activeTab = computed(() => tabs.find(t => t.id === activeTabId.value) || null);
const startedTabs = computed(() => tabs.filter(t => t.started));

const tabContainers = new Map<string, HTMLElement>();

function setContainer(tabId: string, el: HTMLElement | null) {
  if (el) tabContainers.set(tabId, el);
  else tabContainers.delete(tabId);
}

function insertCommand(cmd: string) {
  const tab = activeTab.value;
  if (!tab?.connected) return;
  // Ctrl+U clears current line (works in bash, zsh, and Asterisk CLI)
  emit('terminal:input', { tabId: tab.id, input: '\x15' + cmd });
}

// ── Tab Management ──

function addTab(type: 'remote' | 'local'): TabSession {
  tabCounter++;
  const id = `tab-${tabCounter}`;
  const label = type === 'remote'
    ? (defaultSsh.host || `SSH ${tabCounter}`)
    : `Local ${tabCounter}`;

  const tab: TabSession = {
    id, type, label,
    terminal: null, fitAddon: null,
    connected: false, started: false, loading: false, error: null,
    authMode: 'none', authBuffer: '',
    sshConfig: type === 'remote'
      ? { host: defaultSsh.host, port: defaultSsh.port, username: defaultSsh.username, password: '' }
      : { host: '', port: '22', username: '', password: '' },
  };

  tabs.push(tab);
  activeTabId.value = id;
  return tab;
}

function addLocalTab() {
  const tab = addTab('local');
  nextTick(() => startSession(tab.id));
}

function switchTab(tabId: string) {
  activeTabId.value = tabId;
  nextTick(() => {
    const tab = tabs.find(t => t.id === tabId);
    if (tab?.fitAddon && tab.started) {
      tab.fitAddon.fit();
    }
  });
}

function closeTab(tabId: string) {
  const idx = tabs.findIndex(t => t.id === tabId);
  if (idx < 0) return;

  const tab = tabs[idx]!;

  if (tab.connected || tab.started) {
    emit('terminal:stop', { tabId: tab.id });
  }
  if (tab.fitAddon) { try { tab.fitAddon.dispose(); } catch {} }
  if (tab.terminal) { try { tab.terminal.dispose(); } catch {} }
  tabContainers.delete(tabId);
  tabs.splice(idx, 1);

  if (activeTabId.value === tabId && tabs.length > 0) {
    switchTab(tabs[Math.min(idx, tabs.length - 1)]!.id);
  }
}

function startRenaming(tabId: string) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;
  renamingTabId.value = tabId;
  renameValue.value = tab.label;
  nextTick(() => {
    const input = document.querySelector(`[data-rename-tab="${tabId}"]`) as HTMLInputElement;
    input?.focus();
    input?.select();
  });
}

function finishRenaming() {
  if (renamingTabId.value && renameValue.value.trim()) {
    const tab = tabs.find(t => t.id === renamingTabId.value);
    if (tab) tab.label = renameValue.value.trim();
  }
  renamingTabId.value = null;
}

function cancelRenaming() {
  renamingTabId.value = null;
}

// ── Terminal Lifecycle ──

function createTerminal(tabId: string): Terminal {
  const term = new Terminal({
    cursorBlink: true,
    theme: { background: '#000000', foreground: '#ffffff' },
    fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, "Courier New", monospace',
    fontSize: 14,
  });

  term.onData((data) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    if (tab.authMode !== 'none') {
      handleAuthInput(tabId, data);
    } else {
      emit('terminal:input', { tabId, input: data });
    }
  });

  return term;
}

function startSession(tabId: string) {
  if (!socketConnected.value) return;

  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;

  tab.loading = true;
  tab.error = null;
  tab.started = true;

  if (!tab.terminal) {
    const term = createTerminal(tabId);
    const fit = new FitAddon();
    term.loadAddon(fit);
    tab.terminal = term;
    tab.fitAddon = fit;

    nextTick(() => {
      const container = tabContainers.get(tabId);
      if (container) {
        term.open(container);
        fit.fit();
        initSession(tabId);
      }
    });
  } else {
    tab.terminal.clear();
    initSession(tabId);
  }
}

function initSession(tabId: string) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;

  if (tab.type === 'remote') {
    if (!tab.sshConfig.username) {
      tab.terminal?.write('\r\nAriLink Remote SSH Terminal\r\n');
      tab.terminal?.write(`Host: ${tab.sshConfig.host || '(not set)'}  Port: ${tab.sshConfig.port || '22'}\r\n\r\n`);
      tab.terminal?.write('login: ');
      tab.authMode = 'username';
      tab.authBuffer = '';
    } else {
      tab.terminal?.write(`\r\nConnecting to ${tab.sshConfig.host}...\r\n`);
      connectBackend(tabId);
    }
  } else {
    tab.terminal?.write('\r\nOpening local shell...\r\n');
    connectBackend(tabId);
  }
}

function handleAuthInput(tabId: string, data: string) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab?.terminal) return;

  for (let i = 0; i < data.length; i++) {
    const char = data[i]!;

    if (char === '\r' || char === '\n') {
      const val = tab.authBuffer;
      tab.authBuffer = '';

      if (tab.authMode === 'username') {
        tab.sshConfig.username = val;
        tab.terminal.write('\r\nPassword: ');
        tab.authMode = 'password';
      } else if (tab.authMode === 'password') {
        tab.sshConfig.password = val;
        tab.terminal.write('\r\n\x1b[32mConnecting...\x1b[0m\r\n');
        tab.authMode = 'none';
        connectBackend(tabId);
      }
    } else if (char === '\u007f' || char === '\b') {
      if (tab.authBuffer.length > 0) {
        tab.authBuffer = tab.authBuffer.slice(0, -1);
        if (tab.authMode === 'username') {
          tab.terminal.write('\b \b');
        }
      }
    } else {
      tab.authBuffer += char;
      if (tab.authMode === 'username') {
        tab.terminal.write(char);
      } else {
        tab.terminal.write('*');
      }
    }
  }
}

function connectBackend(tabId: string) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;

  const payload: any = { tabId, type: tab.type };

  if (tab.type === 'remote') {
    if (tab.sshConfig.host) payload.host = tab.sshConfig.host;
    if (tab.sshConfig.port) payload.port = parseInt(tab.sshConfig.port);
    if (tab.sshConfig.username) payload.username = tab.sshConfig.username;
    if (tab.sshConfig.password) payload.password = tab.sshConfig.password;
  }

  emit('terminal:start', payload);

  if (tab.terminal) {
    emit('terminal:resize', { tabId, cols: tab.terminal.cols, rows: tab.terminal.rows });
  }
}

function disconnectTab(tabId: string) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;

  emit('terminal:stop', { tabId });

  tab.connected = false;
  tab.started = false;
  tab.loading = false;
  tab.authMode = 'none';
  tab.authBuffer = '';

  if (tab.type === 'remote') {
    tab.sshConfig.username = '';
    tab.sshConfig.password = '';
  }

  if (tab.fitAddon) { try { tab.fitAddon.dispose(); } catch {} tab.fitAddon = null; }
  if (tab.terminal) { try { tab.terminal.dispose(); } catch {} tab.terminal = null; }
}

// ── Data from server → route to correct tab ──

function handleTerminalData(payload: any) {
  let tabId: string;
  let data: string;

  if (typeof payload === 'string') {
    tabId = activeTabId.value;
    data = payload;
  } else {
    tabId = payload.mode; // Server emits { mode: tabId, data }
    data = payload.data;
  }

  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;

  if (data.includes('*** ERROR:')) {
    const errMsg = data.replace(/\*\*\* ERROR:\s?|\s?\*\*\*/g, '').trim();
    tab.error = errMsg;
    tab.loading = false;
    tab.connected = false;
    tab.started = false;
    return;
  }

  if (!tab.connected && data.trim().length > 0) {
    tab.connected = true;
    tab.loading = false;
  }

  tab.terminal?.write(data);
}

const handleResize = () => {
  const tab = tabs.find(t => t.id === activeTabId.value);
  if (tab?.fitAddon && tab.started) {
    tab.fitAddon.fit();
    if (tab.terminal && tab.connected) {
      emit('terminal:resize', { tabId: tab.id, cols: tab.terminal.cols, rows: tab.terminal.rows });
    }
  }
};

// ── Lifecycle ──

onMounted(async () => {
  on('terminal:data', handleTerminalData);
  window.addEventListener('resize', handleResize);

  try {
    const data = await $fetch('/api/env') as any;
    const sshGroup = data.groups?.find((g: any) => g.group === 'SSH / Asset Management');
    const sshHost = sshGroup?.vars.find((v: any) => v.key === 'SSH_HOST')?.value;

    if (sshHost && sshHost !== 'localhost') {
      const portVar = sshGroup?.vars.find((v: any) => v.key === 'SSH_PORT');
      const userVar = sshGroup?.vars.find((v: any) => v.key === 'SSH_USER');

      // Remember for future tabs
      defaultSsh.host = sshHost;
      if (portVar?.value) defaultSsh.port = portVar.value;
      if (userVar?.value) defaultSsh.username = userVar.value;

      const tab = addTab('remote'); // picks up defaultSsh automatically
      tab.label = sshHost;

      pageInitializing.value = false;
      nextTick(() => startSession(tab.id));
      return;
    }
  } catch (e) {
    console.error('[Terminal] Failed to pre-fetch SSH config:', e);
  }

  if (tabs.length === 0) addTab('remote');
  pageInitializing.value = false;
});

onUnmounted(() => {
  for (const tab of tabs) {
    if (tab.started || tab.connected) {
      emit('terminal:stop', { tabId: tab.id });
    }
  }

  window.removeEventListener('resize', handleResize);
  off('terminal:data', handleTerminalData);

  for (const tab of tabs) {
    if (tab.fitAddon) { try { tab.fitAddon.dispose(); } catch {} }
    if (tab.terminal) { try { tab.terminal.dispose(); } catch {} }
  }
});
</script>

<style>
.xterm {
  padding: 12px;
  height: 100%;
}
.xterm-viewport {
  background-color: transparent !important;
}
.commands-panel-enter-active,
.commands-panel-leave-active {
  transition: transform 0.2s ease;
}
.commands-panel-enter-from,
.commands-panel-leave-to {
  transform: translateX(100%);
}
</style>
