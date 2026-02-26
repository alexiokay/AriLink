<template>
  <div class="cyber-dashboard">
    <!-- Cyber grid background -->
    <div class="cyber-grid" />

    <!-- Header -->
    <header class="cyber-header">
      <div class="flex items-center gap-3">
        <div class="cyber-logo">
          <span class="cyber-logo-text">ARI</span>
          <span class="cyber-logo-accent">LINK</span>
        </div>
        <div class="cyber-divider" />
        <span class="cyber-label">SYSTEM DASHBOARD</span>
      </div>
      <div class="flex items-center gap-4">
        <div class="cyber-indicator" :class="connected ? 'cyber-indicator--ok' : 'cyber-indicator--err'">
          <span class="cyber-indicator-dot" />
          <span class="cyber-indicator-label">{{ connected ? 'ONLINE' : 'OFFLINE' }}</span>
        </div>
        <div class="cyber-badge">
          <span class="cyber-badge-value">{{ activeCalls.length }}</span>
          <span class="cyber-badge-label">CALLS</span>
        </div>
        <div class="cyber-badge cyber-badge--time">
          <span class="cyber-badge-value">{{ currentTime }}</span>
          <span class="cyber-badge-label">LOCAL</span>
        </div>
      </div>
    </header>

    <!-- Service Cards -->
    <section class="cyber-section">
      <h2 class="cyber-section-title">
        <span class="cyber-bracket">[</span> SERVICES <span class="cyber-bracket">]</span>
      </h2>
      <div class="cyber-cards-grid">
        <div
          v-for="(svc, key) in services"
          :key="key"
          class="cyber-card"
          :class="cardClass(svc.status)"
        >
          <div class="cyber-card-inner">
            <!-- Corner decorations -->
            <div class="cyber-corner cyber-corner--tl" />
            <div class="cyber-corner cyber-corner--tr" />
            <div class="cyber-corner cyber-corner--bl" />
            <div class="cyber-corner cyber-corner--br" />

            <div class="cyber-card-header">
              <div class="cyber-card-icon" :class="iconClass(svc.status)">
                <UIcon :name="serviceIcon(key as string)" class="size-5" />
              </div>
              <span class="cyber-card-title">{{ svc.label }}</span>
              <div class="flex items-center gap-1.5 ml-auto">
                <button
                  v-if="hasReconnect(key as string)"
                  class="cyber-btn-icon"
                  :title="`Reconnect ${svc.label}`"
                  @click="reconnectService(key as string)"
                >
                  <UIcon name="i-lucide-refresh-cw" class="size-3.5" :class="{ 'animate-spin': svc.status === 'connecting' }" />
                </button>
                <!-- Docker restart -->
                <div v-if="docker.loading.value && docker.dockerSlug(key as string)" class="size-6 rounded cyber-skeleton" />
                <button
                  v-else-if="docker.status.value.available && docker.dockerSlug(key as string)"
                  class="cyber-btn-icon cyber-btn-icon--warn"
                  :title="`Restart ${svc.label} container`"
                  @click="restartContainer(key as string)"
                >
                  <UIcon name="i-lucide-power" class="size-3.5" :class="{ 'animate-spin': docker.restarting.value[key as string] }" />
                </button>
              </div>
            </div>

            <div class="cyber-card-status">
              <span class="cyber-status-dot" :class="statusDotClass(svc.status)" />
              <span class="cyber-status-text" :class="statusTextClass(svc.status)">{{ svc.status.toUpperCase() }}</span>
            </div>

            <!-- Detail / Address -->
            <p v-if="svc.detail && !isErrorStatus(svc.status)" class="cyber-card-detail">
              {{ svc.detail }}
            </p>

            <!-- Docker container info -->
            <div v-if="docker.loading.value && docker.dockerSlug(key as string)" class="mt-2 h-3 w-36 rounded cyber-skeleton" />
            <p v-else-if="docker.status.value.available && docker.containerFor(key as string)" class="cyber-card-container">
              <span class="cyber-container-label">CONTAINER:</span>
              {{ docker.containerFor(key as string)!.state }}
              <span v-if="docker.containerFor(key as string)!.health !== 'none' && docker.containerFor(key as string)!.health !== 'unknown'">
                ({{ docker.containerFor(key as string)!.health }})
              </span>
              <span v-if="docker.containerFor(key as string)!.uptime" class="cyber-container-uptime">
                {{ docker.containerFor(key as string)!.uptime }}
              </span>
            </p>

            <!-- Error block -->
            <div v-if="svc.detail && isErrorStatus(svc.status)" class="cyber-card-error">
              <p class="cyber-error-msg">{{ parseError(svc.detail).message }}</p>
              <p class="cyber-error-hint">{{ parseError(svc.detail).hint }}</p>
            </div>
          </div>
          <!-- Bottom glow bar -->
          <div class="cyber-card-bar" :class="barClass(svc.status)" />
        </div>
      </div>
    </section>

    <!-- Active Calls -->
    <section class="cyber-section">
      <h2 class="cyber-section-title">
        <span class="cyber-bracket">[</span> ACTIVE CALLS <span class="cyber-bracket">]</span>
        <span class="cyber-count">{{ activeCalls.length }}</span>
      </h2>

      <div class="cyber-panel">
        <div class="cyber-corner cyber-corner--tl" />
        <div class="cyber-corner cyber-corner--tr" />
        <div class="cyber-corner cyber-corner--bl" />
        <div class="cyber-corner cyber-corner--br" />

        <div v-if="activeCalls.length === 0" class="cyber-empty">
          <div class="cyber-empty-icon">
            <UIcon name="i-lucide-phone-off" class="size-8" />
          </div>
          <p class="cyber-empty-text">NO ACTIVE CALLS</p>
          <p class="cyber-empty-sub">System standing by</p>
        </div>

        <div v-else class="cyber-table-wrap">
          <table class="cyber-table">
            <thead>
              <tr>
                <th>CALLER</th>
                <th>EXTENSION</th>
                <th>ASSISTANT</th>
                <th>STATE</th>
                <th>DURATION</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="call in activeCalls" :key="call.id" class="cyber-table-row">
                <td>
                  <div class="flex items-center gap-2">
                    <span class="cyber-pulse-dot" />
                    <span class="cyber-caller">{{ call.callerName || call.callerId || 'UNKNOWN' }}</span>
                  </div>
                  <span v-if="call.callerId" class="cyber-caller-id">{{ call.callerId }}</span>
                </td>
                <td class="cyber-mono">{{ call.extension || '—' }}</td>
                <td>
                  <span class="cyber-assistant-tag">{{ call.assistantName || call.assistant || '—' }}</span>
                </td>
                <td>
                  <span
                    v-if="getCallState(call.id)"
                    class="cyber-state-badge"
                    :class="stateBadgeClass(getCallState(call.id)!.state)"
                  >
                    {{ getCallState(call.id)!.state.toUpperCase() }}
                  </span>
                  <span v-else class="cyber-state-badge cyber-state-badge--idle">IDLE</span>
                </td>
                <td class="cyber-mono cyber-duration">{{ callDuration(call) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Recent Activity Feed -->
    <section class="cyber-section">
      <h2 class="cyber-section-title">
        <span class="cyber-bracket">[</span> LIVE FEED <span class="cyber-bracket">]</span>
      </h2>
      <div class="cyber-panel cyber-panel--feed">
        <div class="cyber-corner cyber-corner--tl" />
        <div class="cyber-corner cyber-corner--tr" />
        <div class="cyber-corner cyber-corner--bl" />
        <div class="cyber-corner cyber-corner--br" />

        <div v-if="recentLogs.length === 0" class="cyber-empty">
          <p class="cyber-empty-text">NO LOG ENTRIES</p>
        </div>
        <div v-else class="cyber-feed">
          <div v-for="entry in recentLogs" :key="entry.id" class="cyber-feed-line">
            <span class="cyber-feed-time">{{ formatLogTime(entry.timestamp) }}</span>
            <span class="cyber-feed-level" :class="feedLevelClass(entry.level)">{{ entry.level?.toUpperCase() || 'LOG' }}</span>
            <span class="cyber-feed-msg">{{ entry.message }}</span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'cyberpunk' });

const { connected, activeCalls, services, emit, assistantStates, logs } = useSocket();
const docker = useDocker();

onMounted(() => docker.startPolling(15000));
onUnmounted(() => docker.stopPolling());

// Live clock
const currentTime = ref('');
let clockTimer: ReturnType<typeof setInterval> | null = null;
function updateClock() {
  currentTime.value = new Date().toLocaleTimeString('en-US', { hour12: false });
}
onMounted(() => {
  updateClock();
  clockTimer = setInterval(updateClock, 1000);
});
onUnmounted(() => { if (clockTimer) clearInterval(clockTimer); });

// Recent logs (last 30)
const recentLogs = computed(() => logs.value.slice(0, 30));

function formatLogTime(ts: number | string) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function feedLevelClass(level: string) {
  if (level === 'error') return 'cyber-feed-level--err';
  if (level === 'warn') return 'cyber-feed-level--warn';
  return 'cyber-feed-level--info';
}

// Service helpers
function serviceIcon(key: string): string {
  const icons: Record<string, string> = {
    asterisk: 'i-lucide-server',
    rustRtp: 'i-lucide-radio',
    transcription: 'i-lucide-mic',
    tts: 'i-lucide-volume-2',
  };
  return icons[key] || 'i-lucide-circle';
}

function hasReconnect(key: string): boolean {
  return key === 'asterisk' || key === 'transcription' || key === 'rustRtp' || key === 'tts';
}

function reconnectService(key: string) {
  if (key === 'asterisk') emit('dashboard:reconnectAri');
  else if (key === 'transcription' || key === 'rustRtp') emit('dashboard:reconnectTranscription');
  else if (key === 'tts') emit('dashboard:reconnectTts');
}

function restartContainer(key: string) {
  const slug = docker.dockerSlug(key);
  if (!slug) return;
  docker.restarting.value[key] = true;
  emit('dashboard:restartContainer', { service: slug });
  setTimeout(() => {
    docker.restarting.value[key] = false;
    docker.fetchStatus();
  }, 8000);
}

function isErrorStatus(status: string): boolean {
  return status === 'error' || status === 'disconnected';
}

function parseError(detail: string): { message: string; hint: string } {
  const d = detail.toLowerCase();
  if (d.includes('etimedout')) {
    const host = detail.match(/\d+\.\d+\.\d+\.\d+[:\d]*/)?.[0] || '';
    return { message: `Connection timed out${host ? ` (${host})` : ''}`, hint: 'Host unreachable — check IP, firewall, and service status.' };
  }
  if (d.includes('econnrefused')) {
    const host = detail.match(/\d+\.\d+\.\d+\.\d+[:\d]*/)?.[0] || detail.match(/localhost[:\d]*/)?.[0] || '';
    return { message: `Connection refused${host ? ` (${host})` : ''}`, hint: 'Port closed — service may not be running.' };
  }
  if (d.includes('econnreset')) return { message: 'Connection reset', hint: 'Service dropped connection — may have crashed.' };
  if (d.includes('enotfound')) return { message: 'Host not found', hint: 'DNS lookup failed — check hostname in .env.' };
  if (d.includes('401') || d.includes('unauthorized')) return { message: 'Auth failed', hint: 'Wrong credentials in .env.' };
  return { message: detail.length > 60 ? detail.slice(0, 60) + '...' : detail, hint: 'Check server logs.' };
}

// Card styling
function cardClass(status: string) {
  if (status === 'ok' || status === 'connected') return 'cyber-card--ok';
  if (status === 'error' || status === 'disconnected') return 'cyber-card--err';
  if (status === 'connecting') return 'cyber-card--warn';
  return 'cyber-card--neutral';
}

function iconClass(status: string) {
  if (status === 'ok' || status === 'connected') return 'cyber-icon--ok';
  if (status === 'error' || status === 'disconnected') return 'cyber-icon--err';
  if (status === 'connecting') return 'cyber-icon--warn';
  return 'cyber-icon--neutral';
}

function statusDotClass(status: string) {
  if (status === 'ok' || status === 'connected') return 'cyber-dot--ok';
  if (status === 'error' || status === 'disconnected') return 'cyber-dot--err';
  if (status === 'connecting') return 'cyber-dot--warn';
  return 'cyber-dot--neutral';
}

function statusTextClass(status: string) {
  if (status === 'ok' || status === 'connected') return 'text-cyber-green';
  if (status === 'error' || status === 'disconnected') return 'text-cyber-red';
  if (status === 'connecting') return 'text-cyber-yellow';
  return 'text-cyber-muted';
}

function barClass(status: string) {
  if (status === 'ok' || status === 'connected') return 'cyber-bar--ok';
  if (status === 'error' || status === 'disconnected') return 'cyber-bar--err';
  if (status === 'connecting') return 'cyber-bar--warn';
  return 'cyber-bar--neutral';
}

// Call helpers
function getCallState(sessionId: string) {
  return assistantStates.value[sessionId] || null;
}

function stateBadgeClass(state: string) {
  if (state === 'listening') return 'cyber-state-badge--ok';
  if (state === 'speaking') return 'cyber-state-badge--cyan';
  if (state === 'processing') return 'cyber-state-badge--warn';
  return 'cyber-state-badge--neutral';
}

function callDuration(call: any): string {
  if (!call.startTime) return '—';
  const seconds = Math.floor((Date.now() - new Date(call.startTime).getTime()) / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Refresh call durations every second
let durationTimer: ReturnType<typeof setInterval> | null = null;
const durationTick = ref(0);
onMounted(() => { durationTimer = setInterval(() => durationTick.value++, 1000); });
onUnmounted(() => { if (durationTimer) clearInterval(durationTimer); });
</script>

<style scoped>
/* ═══════════════════════════════════════
   CYBERPUNK THEME — Scoped to this page
   ═══════════════════════════════════════ */

/* CSS custom properties for the cyberpunk palette */
.cyber-dashboard {
  --cyber-cyan: #00f0ff;
  --cyber-purple: #9d4edd;
  --cyber-green: #00ff9d;
  --cyber-yellow: #fcee0a;
  --cyber-red: #ff003c;
  --cyber-bg: #0e1018;
  --cyber-bg-card: #151822;
  --cyber-bg-panel: #13161f;
  --cyber-border: #252a3a;
  --cyber-text: #d0d4e0;
  --cyber-text-bright: #eef0f6;
  --cyber-text-muted: #727a92;

  position: relative;
  min-height: 100vh;
  background: var(--cyber-bg);
  color: var(--cyber-text);
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', monospace;
  padding: 1.5rem;
  overflow-x: hidden;
}

/* Animated grid background */
.cyber-grid {
  position: fixed;
  inset: 0;
  background-image:
    linear-gradient(rgba(0, 240, 255, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 240, 255, 0.04) 1px, transparent 1px);
  background-size: 40px 40px;
  pointer-events: none;
  z-index: 0;
}

/* ─── Header ─── */
.cyber-header {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  margin-bottom: 2rem;
  background: linear-gradient(135deg, rgba(0, 240, 255, 0.06), rgba(112, 0, 255, 0.06));
  border: 1px solid var(--cyber-border);
  border-radius: 4px;
}

.cyber-logo {
  display: flex;
  gap: 0.25rem;
  font-size: 1.5rem;
  font-weight: 900;
  letter-spacing: 0.15em;
}

.cyber-logo-text {
  color: var(--cyber-text-bright);
}

.cyber-logo-accent {
  color: var(--cyber-cyan);
  text-shadow: 0 0 10px rgba(0, 240, 255, 0.5), 0 0 30px rgba(0, 240, 255, 0.2);
}

.cyber-divider {
  width: 1px;
  height: 1.5rem;
  background: var(--cyber-border);
  margin: 0 0.75rem;
}

.cyber-label {
  font-size: 0.65rem;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--cyber-text-muted);
}

/* Indicators */
.cyber-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.75rem;
  border: 1px solid var(--cyber-border);
  border-radius: 2px;
  font-size: 0.7rem;
  letter-spacing: 0.15em;
}

.cyber-indicator--ok {
  border-color: rgba(0, 255, 157, 0.3);
}

.cyber-indicator--err {
  border-color: rgba(255, 0, 60, 0.3);
}

.cyber-indicator-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  animation: pulse-dot 2s ease-in-out infinite;
}

.cyber-indicator--ok .cyber-indicator-dot {
  background: var(--cyber-green);
  box-shadow: 0 0 6px var(--cyber-green);
}

.cyber-indicator--err .cyber-indicator-dot {
  background: var(--cyber-red);
  box-shadow: 0 0 6px var(--cyber-red);
}

.cyber-indicator--ok .cyber-indicator-label {
  color: var(--cyber-green);
}

.cyber-indicator--err .cyber-indicator-label {
  color: var(--cyber-red);
}

.cyber-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.25rem 0.75rem;
  border: 1px solid var(--cyber-border);
  border-radius: 2px;
  min-width: 3rem;
}

.cyber-badge-value {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--cyber-cyan);
  letter-spacing: 0.05em;
}

.cyber-badge-label {
  font-size: 0.5rem;
  letter-spacing: 0.2em;
  color: var(--cyber-text-muted);
  text-transform: uppercase;
}

.cyber-badge--time .cyber-badge-value {
  font-variant-numeric: tabular-nums;
  color: var(--cyber-purple);
  text-shadow: 0 0 8px rgba(112, 0, 255, 0.4);
}

/* ─── Sections ─── */
.cyber-section {
  position: relative;
  z-index: 1;
  margin-bottom: 2rem;
}

.cyber-section-title {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--cyber-text-muted);
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.cyber-bracket {
  color: var(--cyber-cyan);
  font-weight: 400;
}

.cyber-count {
  color: var(--cyber-cyan);
  font-size: 0.8rem;
  margin-left: 0.25rem;
}

/* ─── Service Cards ─── */
.cyber-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1rem;
}

.cyber-card {
  position: relative;
  border-radius: 4px;
  overflow: hidden;
  transition: all 0.3s ease;
  border: 1px solid var(--cyber-border);
  background: var(--cyber-bg-card);
  display: flex;
  flex-direction: column;
}

.cyber-card:hover {
  transform: translateY(-2px);
}

.cyber-card--ok:hover {
  border-color: rgba(0, 255, 157, 0.3);
  box-shadow: 0 0 20px rgba(0, 255, 157, 0.08);
}

.cyber-card--err:hover {
  border-color: rgba(255, 0, 60, 0.3);
  box-shadow: 0 0 20px rgba(255, 0, 60, 0.08);
}

.cyber-card--warn:hover {
  border-color: rgba(252, 238, 10, 0.3);
  box-shadow: 0 0 20px rgba(252, 238, 10, 0.08);
}

.cyber-card-inner {
  position: relative;
  padding: 1rem 1.25rem;
  flex: 1;
}

.cyber-card-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.cyber-card-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0.375rem;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--cyber-border);
  flex-shrink: 0;
}

.cyber-icon--ok { color: var(--cyber-green); border-color: rgba(0, 255, 157, 0.3); }
.cyber-icon--err { color: var(--cyber-red); border-color: rgba(255, 0, 60, 0.3); }
.cyber-icon--warn { color: var(--cyber-yellow); border-color: rgba(252, 238, 10, 0.3); }
.cyber-icon--neutral { color: var(--cyber-text-muted); }

.cyber-card-title {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--cyber-text-bright);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cyber-card-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.cyber-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.cyber-dot--ok { background: var(--cyber-green); box-shadow: 0 0 8px rgba(0, 255, 157, 0.5); animation: pulse-dot 2s ease-in-out infinite; }
.cyber-dot--err { background: var(--cyber-red); box-shadow: 0 0 8px rgba(255, 0, 60, 0.5); }
.cyber-dot--warn { background: var(--cyber-yellow); box-shadow: 0 0 8px rgba(252, 238, 10, 0.5); animation: pulse-dot 1s ease-in-out infinite; }
.cyber-dot--neutral { background: var(--cyber-text-muted); }

.cyber-status-text {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.2em;
}

.text-cyber-green { color: var(--cyber-green); }
.text-cyber-red { color: var(--cyber-red); }
.text-cyber-yellow { color: var(--cyber-yellow); }
.text-cyber-muted { color: var(--cyber-text-muted); }

.cyber-card-detail {
  font-size: 0.65rem;
  color: var(--cyber-text);
  opacity: 0.7;
  letter-spacing: 0.05em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cyber-card-container {
  font-size: 0.6rem;
  color: var(--cyber-text);
  opacity: 0.6;
  letter-spacing: 0.05em;
  margin-top: 0.5rem;
}

.cyber-container-label {
  color: var(--cyber-cyan);
  opacity: 0.8;
}

.cyber-container-uptime {
  opacity: 0.7;
  margin-left: 0.5rem;
}

.cyber-card-error {
  margin-top: 0.75rem;
  padding: 0.5rem 0.75rem;
  border-radius: 2px;
  background: rgba(255, 0, 60, 0.05);
  border: 1px solid rgba(255, 0, 60, 0.15);
}

.cyber-error-msg {
  font-size: 0.7rem;
  color: var(--cyber-red);
  font-weight: 600;
}

.cyber-error-hint {
  font-size: 0.6rem;
  color: var(--cyber-text-muted);
  margin-top: 0.25rem;
}

/* Bottom glow bar */
.cyber-card-bar {
  height: 2px;
  transition: all 0.3s ease;
}

.cyber-bar--ok { background: var(--cyber-green); box-shadow: 0 0 10px rgba(0, 255, 157, 0.4); }
.cyber-bar--err { background: var(--cyber-red); box-shadow: 0 0 10px rgba(255, 0, 60, 0.4); }
.cyber-bar--warn { background: var(--cyber-yellow); box-shadow: 0 0 10px rgba(252, 238, 10, 0.4); }
.cyber-bar--neutral { background: var(--cyber-border); }

/* ─── Corner Decorations ─── */
.cyber-corner {
  position: absolute;
  width: 8px;
  height: 8px;
  border-color: rgba(0, 240, 255, 0.4);
  border-style: solid;
  border-width: 0;
  pointer-events: none;
}

.cyber-corner--tl { top: 0; left: 0; border-top-width: 1px; border-left-width: 1px; }
.cyber-corner--tr { top: 0; right: 0; border-top-width: 1px; border-right-width: 1px; }
.cyber-corner--bl { bottom: 0; left: 0; border-bottom-width: 1px; border-left-width: 1px; }
.cyber-corner--br { bottom: 0; right: 0; border-bottom-width: 1px; border-right-width: 1px; }

/* ─── Buttons ─── */
.cyber-btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  padding: 0.25rem;
  border-radius: 2px;
  border: 1px solid var(--cyber-border);
  background: transparent;
  color: var(--cyber-text-muted);
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.cyber-btn-icon:hover {
  color: var(--cyber-cyan);
  border-color: rgba(0, 240, 255, 0.3);
  background: rgba(0, 240, 255, 0.05);
}

.cyber-btn-icon--warn:hover {
  color: var(--cyber-yellow);
  border-color: rgba(252, 238, 10, 0.3);
  background: rgba(252, 238, 10, 0.05);
}

/* ─── Panels ─── */
.cyber-panel {
  position: relative;
  background: var(--cyber-bg-panel);
  border: 1px solid var(--cyber-border);
  border-radius: 4px;
  overflow: hidden;
}

.cyber-panel--feed {
  max-height: 300px;
  overflow-y: auto;
}

.cyber-panel--feed::-webkit-scrollbar {
  width: 4px;
}

.cyber-panel--feed::-webkit-scrollbar-track {
  background: var(--cyber-bg);
}

.cyber-panel--feed::-webkit-scrollbar-thumb {
  background: var(--cyber-border);
  border-radius: 2px;
}

/* ─── Tables ─── */
.cyber-table-wrap {
  overflow-x: auto;
}

.cyber-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
}

.cyber-table thead th {
  padding: 0.75rem 1rem;
  text-align: left;
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--cyber-text-muted);
  border-bottom: 1px solid var(--cyber-border);
  background: rgba(0, 240, 255, 0.04);
}

.cyber-table-row td {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid rgba(26, 26, 46, 0.5);
  vertical-align: middle;
}

.cyber-table-row {
  transition: background 0.15s ease;
}

.cyber-table-row:hover {
  background: rgba(0, 240, 255, 0.03);
}

.cyber-mono {
  font-family: 'JetBrains Mono', monospace;
  letter-spacing: 0.05em;
}

.cyber-caller {
  font-weight: 600;
  color: var(--cyber-text-bright);
  font-size: 0.8rem;
}

.cyber-caller-id {
  display: block;
  font-size: 0.6rem;
  color: var(--cyber-text-muted);
  margin-top: 0.15rem;
  font-family: 'JetBrains Mono', monospace;
}

.cyber-pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cyber-green);
  box-shadow: 0 0 6px var(--cyber-green);
  animation: pulse-dot 2s ease-in-out infinite;
  flex-shrink: 0;
}

.cyber-assistant-tag {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  font-size: 0.6rem;
  letter-spacing: 0.1em;
  border: 1px solid rgba(112, 0, 255, 0.3);
  border-radius: 2px;
  color: var(--cyber-purple);
  background: rgba(112, 0, 255, 0.05);
  text-transform: uppercase;
}

.cyber-duration {
  color: var(--cyber-cyan);
  font-variant-numeric: tabular-nums;
}

/* State badges */
.cyber-state-badge {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  border-radius: 2px;
  border: 1px solid;
}

.cyber-state-badge--ok {
  color: var(--cyber-green);
  border-color: rgba(0, 255, 157, 0.3);
  background: rgba(0, 255, 157, 0.05);
}

.cyber-state-badge--err {
  color: var(--cyber-red);
  border-color: rgba(255, 0, 60, 0.3);
  background: rgba(255, 0, 60, 0.05);
}

.cyber-state-badge--warn {
  color: var(--cyber-yellow);
  border-color: rgba(252, 238, 10, 0.3);
  background: rgba(252, 238, 10, 0.05);
}

.cyber-state-badge--cyan {
  color: var(--cyber-cyan);
  border-color: rgba(0, 240, 255, 0.3);
  background: rgba(0, 240, 255, 0.05);
}

.cyber-state-badge--idle,
.cyber-state-badge--neutral {
  color: var(--cyber-text-muted);
  border-color: var(--cyber-border);
  background: rgba(255, 255, 255, 0.02);
}

/* ─── Empty State ─── */
.cyber-empty {
  padding: 3rem 1rem;
  text-align: center;
}

.cyber-empty-icon {
  color: var(--cyber-text-muted);
  opacity: 0.5;
  margin-bottom: 0.75rem;
}

.cyber-empty-text {
  font-size: 0.7rem;
  letter-spacing: 0.3em;
  color: var(--cyber-text);
  opacity: 0.5;
}

.cyber-empty-sub {
  font-size: 0.6rem;
  color: var(--cyber-text);
  opacity: 0.35;
  margin-top: 0.25rem;
  letter-spacing: 0.1em;
}

/* ─── Live Feed ─── */
.cyber-feed {
  padding: 0.5rem 0;
}

.cyber-feed-line {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.3rem 1rem;
  font-size: 0.65rem;
  transition: background 0.1s ease;
}

.cyber-feed-line:hover {
  background: rgba(0, 240, 255, 0.02);
}

.cyber-feed-time {
  color: var(--cyber-text-muted);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.cyber-feed-level {
  flex-shrink: 0;
  font-weight: 700;
  letter-spacing: 0.1em;
  min-width: 3rem;
}

.cyber-feed-level--info { color: var(--cyber-cyan); }
.cyber-feed-level--warn { color: var(--cyber-yellow); }
.cyber-feed-level--err { color: var(--cyber-red); }

.cyber-feed-msg {
  color: var(--cyber-text);
  word-break: break-all;
}

/* ─── Skeleton ─── */
.cyber-skeleton {
  background: linear-gradient(90deg, var(--cyber-border) 25%, rgba(0, 240, 255, 0.05) 50%, var(--cyber-border) 75%);
  background-size: 200% 100%;
  animation: cyber-shimmer 1.5s ease-in-out infinite;
}

/* ─── Animations ─── */
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

@keyframes cyber-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
