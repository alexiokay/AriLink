<template>
  <!-- Incoming call notification (floats above widget) -->
  <Teleport to="body">
    <Transition name="slide-up">
      <div
        v-if="callState === 'ringing-in' && !expanded"
        class="fixed bottom-20 right-4 z-[60] bg-(--ui-bg-elevated) border border-(--ui-border) rounded-xl shadow-xl px-5 py-3 flex items-center gap-3"
        style="width: 300px;"
      >
        <UIcon name="i-lucide-phone-incoming" class="size-5 text-(--ui-success) animate-pulse shrink-0" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-(--ui-text-highlighted) truncate">Incoming Call</p>
          <p class="text-xs font-mono text-(--ui-text-muted) truncate">{{ remoteNumber || "Unknown" }}</p>
        </div>
        <div class="flex gap-1.5 shrink-0">
          <UButton icon="i-lucide-phone" color="success" size="xs" @click="answer()" />
          <UButton icon="i-lucide-phone-off" color="error" variant="soft" size="xs" @click="reject()" />
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- Floating widget (z-[52] to sit above the assets audio player which is z-50) -->
  <div class="fixed bottom-4 right-4 z-[52] flex flex-col items-end">
    <Transition name="fade-scale" mode="out-in">
      <!-- Collapsed: pill button -->
      <button
        v-if="!expanded"
        key="collapsed"
        class="flex items-center gap-2 px-3 py-2 rounded-full bg-(--ui-bg-elevated) border border-(--ui-border) shadow-lg hover:shadow-xl transition-all cursor-pointer"
        @click="expanded = true"
      >
        <span class="relative">
          <UIcon name="i-lucide-headset" class="size-5 text-(--ui-primary)" />
          <span
            class="absolute -top-0.5 -right-0.5 size-2 rounded-full"
            :class="regState === 'registered' ? 'bg-(--ui-success)' : regState === 'error' ? 'bg-(--ui-error)' : 'bg-(--ui-text-dimmed)'"
          />
        </span>

        <!-- Show mini call status when in a call -->
        <template v-if="callState !== 'idle'">
          <UBadge :label="callStatusLabel" :color="callStatusColor" variant="subtle" size="xs" />
          <span v-if="callState === 'connected'" class="text-xs text-(--ui-text-muted) tabular-nums">
            {{ liveDuration }}
          </span>
        </template>
        <template v-else>
          <span class="text-xs text-(--ui-text-muted)">{{ currentAccountLabel }}</span>
        </template>
      </button>

      <!-- Expanded: compact phone panel -->
      <div
        v-else
        key="expanded"
        class="bg-(--ui-bg-elevated) border border-(--ui-border) rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style="width: 300px; max-height: 460px;"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-4 py-2.5 border-b border-(--ui-border)">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-headset" class="size-4 text-(--ui-primary)" />
            <span class="text-sm font-semibold text-(--ui-text-highlighted)">Softphone</span>
            <UBadge :label="regLabel" :color="regColor" variant="subtle" size="xs" />
          </div>
          <div class="flex items-center gap-1">
            <UButton
              v-if="callState === 'idle'"
              icon="i-lucide-settings"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="openSetup"
            />
            <UButton icon="i-lucide-minimize-2" variant="ghost" color="neutral" size="xs" @click="expanded = false" />
          </div>
        </div>

        <!-- Error display -->
        <div v-if="regError" class="mx-3 mt-2 px-3 py-1.5 rounded-md bg-(--ui-error)/5 border border-(--ui-error)/15">
          <p class="text-xs text-(--ui-error)">{{ regError }}</p>
        </div>
        <div v-if="micError" class="mx-3 mt-2 px-3 py-1.5 rounded-md bg-(--ui-warning)/5 border border-(--ui-warning)/15">
          <p class="text-xs text-(--ui-warning)">{{ micError }}</p>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto px-3 py-2.5">
          <!-- SETUP FORM (overlays any state) -->
          <template v-if="showSetup">
            <div class="space-y-2.5">
              <!-- FreePBX setup hint (collapsible) -->
              <button
                class="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-(--ui-primary)/5 border border-(--ui-primary)/15 text-left cursor-pointer"
                @click="showHint = !showHint"
              >
                <UIcon name="i-lucide-info" class="size-3.5 text-(--ui-primary) shrink-0" />
                <span class="text-xs font-medium text-(--ui-text-muted) flex-1">FreePBX setup guide</span>
                <UIcon :name="showHint ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-3 text-(--ui-text-dimmed) shrink-0" />
              </button>
              <div v-if="showHint" class="px-2.5 py-2 rounded-md bg-(--ui-primary)/5 border border-(--ui-primary)/15">
                <p class="text-xs text-(--ui-text-muted) leading-relaxed">
                  Each extension needs <b>WebRTC enabled</b> in FreePBX:
                  Advanced tab &rarr; Enable AVPF, ICE, rtcp Mux, WebRTC defaults = <b>Yes</b>,
                  Media Encryption = <b>DTLS-SRTP</b>, DTLS = <b>Yes</b>, Auto Generate Cert = <b>Yes</b>.
                </p>
                <p class="text-xs text-(--ui-text-muted) leading-relaxed mt-1">
                  <b>Credentials:</b> Extension number + <b>Secret</b> from the General tab.
                  FreePBX shows two passwords &mdash; use <b>Secret</b> (SIP auth), not
                  "Password For New User" (web portal only). If registration fails, try the other one.
                </p>
              </div>
              <div>
                <label class="text-xs text-(--ui-text-dimmed) mb-1 block">WebSocket URL</label>
                <UInput v-model="setup.wsUrl" placeholder="wss://192.168.1.20:8089/ws" size="sm" class="w-full font-mono" />
                <p v-if="setup.wsUrl && !setup.wsUrl.endsWith('/ws')" class="text-[10px] text-(--ui-warning) mt-0.5">
                  Asterisk requires the <b>/ws</b> path (e.g. wss://IP:8089/ws).
                </p>
              </div>
              <div>
                <label class="text-xs text-(--ui-text-dimmed) mb-1 block">SIP Domain</label>
                <UInput v-model="setup.domain" placeholder="192.168.1.20" size="sm" class="w-full font-mono" />
              </div>
              <div>
                <label class="text-xs text-(--ui-text-dimmed) mb-1 block">STUN Server</label>
                <UInput v-model="setup.stunServer" placeholder="stun:stun.l.google.com:19302" size="sm" class="w-full font-mono" />
              </div>

              <!-- Audio Codecs (collapsible) -->
              <div>
                <button
                  class="w-full flex items-center gap-1.5 text-left cursor-pointer"
                  @click="showCodecs = !showCodecs"
                >
                  <UIcon :name="showCodecs ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3 text-(--ui-text-dimmed) shrink-0" />
                  <span class="text-xs text-(--ui-text-dimmed)">Audio Codecs</span>
                  <span class="text-[10px] text-(--ui-text-dimmed) ml-auto">{{ setup.codecs.join(', ') }}</span>
                </button>
                <div v-if="showCodecs" class="mt-1.5 space-y-1">
                  <div
                    v-for="(c, i) in setup.codecs"
                    :key="c"
                    class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-(--ui-bg-accented) border border-(--ui-border)"
                  >
                    <span class="text-[10px] text-(--ui-text-dimmed) w-3 text-center shrink-0">{{ i + 1 }}</span>
                    <span class="text-xs font-medium text-(--ui-text-highlighted) flex-1">{{ c }}</span>
                    <button
                      v-if="i > 0"
                      class="p-0.5 rounded hover:bg-(--ui-bg-elevated) cursor-pointer"
                      title="Move up"
                      @click="moveCodec(i, -1)"
                    >
                      <UIcon name="i-lucide-chevron-up" class="size-3 text-(--ui-text-dimmed)" />
                    </button>
                    <button
                      v-if="i < setup.codecs.length - 1"
                      class="p-0.5 rounded hover:bg-(--ui-bg-elevated) cursor-pointer"
                      title="Move down"
                      @click="moveCodec(i, 1)"
                    >
                      <UIcon name="i-lucide-chevron-down" class="size-3 text-(--ui-text-dimmed)" />
                    </button>
                    <button
                      class="p-0.5 rounded hover:bg-(--ui-error)/10 cursor-pointer"
                      title="Remove"
                      @click="setup.codecs.splice(i, 1)"
                    >
                      <UIcon name="i-lucide-x" class="size-3 text-(--ui-text-dimmed)" />
                    </button>
                  </div>
                  <!-- Add codec buttons for any not in list -->
                  <div v-if="unusedCodecs.length" class="flex gap-1 mt-1">
                    <button
                      v-for="c in unusedCodecs"
                      :key="c"
                      class="text-[10px] px-1.5 py-0.5 rounded border border-dashed border-(--ui-border) text-(--ui-text-dimmed) hover:text-(--ui-text-highlighted) hover:border-(--ui-primary)/30 cursor-pointer"
                      @click="setup.codecs.push(c)"
                    >
                      + {{ c }}
                    </button>
                  </div>
                  <p class="text-[10px] text-(--ui-text-dimmed)">Top = highest priority. telephone-event always included for DTMF.</p>
                </div>
              </div>

              <!-- Accounts -->
              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="text-xs text-(--ui-text-dimmed)">Accounts</label>
                  <UButton icon="i-lucide-plus" size="xs" variant="ghost" color="neutral" @click="addSetupAccount" />
                </div>
                <div v-for="(acc, i) in setup.accounts" :key="i" class="flex gap-1 mb-1.5 items-start">
                  <UInput v-model="acc.extension" placeholder="Ext" size="xs" class="w-16 font-mono" />
                  <UInput v-model="acc.password" placeholder="Password" size="xs" class="flex-1 font-mono" type="password" />
                  <UInput v-model="acc.label" placeholder="Label" size="xs" class="w-20" />
                  <UButton
                    v-if="setup.accounts.length > 1"
                    icon="i-lucide-x"
                    size="xs"
                    variant="ghost"
                    color="error"
                    @click="setup.accounts.splice(i, 1)"
                  />
                </div>
              </div>

              <div v-if="setupError" class="px-2 py-1.5 rounded-md bg-(--ui-error)/5 border border-(--ui-error)/15">
                <p class="text-xs text-(--ui-error)">{{ setupError }}</p>
              </div>

              <div class="flex gap-2 pt-1">
                <UButton
                  icon="i-lucide-save"
                  label="Save & Connect"
                  size="xs"
                  color="primary"
                  class="flex-1 justify-center"
                  :loading="setupSaving"
                  @click="saveSetup"
                />
                <UButton label="Cancel" size="xs" variant="ghost" color="neutral" @click="showSetup = false" />
              </div>
            </div>
          </template>

          <!-- NOT CONFIGURED (initial state) -->
          <template v-else-if="!config?.configured">
            <div class="text-center py-4">
              <UIcon name="i-lucide-headset" class="size-7 text-(--ui-text-dimmed) mx-auto mb-2" />
              <p class="text-sm text-(--ui-text-muted) mb-1">Not configured</p>
              <p v-if="config?.error" class="text-xs text-(--ui-warning) mb-2">{{ config.error }}</p>
              <div class="flex gap-2 justify-center mt-3">
                <UButton icon="i-lucide-settings" label="Setup" size="xs" color="primary" @click="openSetup" />
                <UButton icon="i-lucide-refresh-cw" label="Refresh" size="xs" variant="soft" color="neutral" @click="init()" />
              </div>
            </div>
          </template>

          <!-- IDLE: accounts + dial -->
          <template v-else-if="callState === 'idle'">
            <!-- Account lines -->
            <div v-if="config.accounts.length > 1" class="mb-2.5 space-y-1">
              <button
                v-for="(account, i) in config.accounts"
                :key="i"
                class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-colors text-left"
                :class="activeAccountIdx === i
                  ? 'bg-(--ui-primary)/10 border border-(--ui-primary)/20'
                  : 'hover:bg-(--ui-bg-accented) border border-transparent'"
                @click="switchAccount(i)"
              >
                <span
                  class="size-2 rounded-full shrink-0"
                  :class="activeAccountIdx === i && regState === 'registered' ? 'bg-(--ui-success)' : 'bg-(--ui-text-dimmed)'"
                />
                <span class="text-xs font-medium text-(--ui-text-highlighted) truncate">
                  {{ account.label || account.extension }}
                </span>
                <span class="text-xs text-(--ui-text-dimmed) ml-auto shrink-0">{{ account.extension }}</span>
              </button>
            </div>

            <!-- Single account display -->
            <div v-else-if="config.accounts.length === 1" class="mb-2.5 flex items-center gap-2 px-2.5 py-1.5">
              <span
                class="size-2 rounded-full shrink-0"
                :class="regState === 'registered' ? 'bg-(--ui-success)' : 'bg-(--ui-text-dimmed)'"
              />
              <span class="text-xs text-(--ui-text-highlighted)">
                {{ config.accounts[0]!.label || config.accounts[0]!.extension }}
              </span>
            </div>

            <!-- Number input + dial -->
            <div class="flex gap-1.5 mb-2">
              <UInput
                v-model="dialNumber"
                placeholder="Number..."
                icon="i-lucide-phone"
                class="flex-1 font-mono"
                size="sm"
                @keyup.enter="dialNumber.trim() && dial(dialNumber.trim())"
              />
              <UButton
                icon="i-lucide-phone"
                color="success"
                size="sm"
                :disabled="!dialNumber.trim() || regState !== 'registered'"
                @click="dial(dialNumber.trim())"
              />
            </div>

            <!-- Dial pad toggle -->
            <div>
              <button
                class="text-xs text-(--ui-text-dimmed) flex items-center gap-1 mb-1.5"
                @click="showDialpad = !showDialpad"
              >
                <UIcon :name="showDialpad ? 'i-lucide-chevron-up' : 'i-lucide-grid-3x3'" class="size-3" />
                Dial Pad
              </button>
              <SoftphoneDialpad v-if="showDialpad" @press="onDialpadPress" />
            </div>
          </template>

          <!-- RINGING OUT -->
          <template v-else-if="callState === 'ringing-out'">
            <div class="text-center py-4">
              <UIcon name="i-lucide-phone-outgoing" class="size-7 text-(--ui-primary) mx-auto mb-2 animate-pulse" />
              <p class="text-sm font-medium text-(--ui-text-highlighted)">Calling...</p>
              <p class="text-sm font-mono text-(--ui-text-muted)">{{ remoteNumber }}</p>
            </div>
          </template>

          <!-- CONNECTED / HOLDING -->
          <template v-else-if="callState === 'connected' || callState === 'holding'">
            <div class="text-center mb-3">
              <p class="text-xs text-(--ui-text-dimmed)">{{ callDirection === 'inbound' ? 'Incoming' : 'Outgoing' }}</p>
              <p class="text-base font-mono font-semibold text-(--ui-text-highlighted)">{{ remoteNumber }}</p>
              <p class="text-sm text-(--ui-text-muted) tabular-nums">{{ liveDuration }}</p>
              <UBadge v-if="isOnHold" label="On Hold" color="warning" variant="subtle" size="xs" class="mt-1" />
            </div>

            <!-- Call controls -->
            <div class="flex items-center justify-center gap-2 mb-2.5">
              <UButton
                :icon="isMuted ? 'i-lucide-mic-off' : 'i-lucide-mic'"
                :color="isMuted ? 'error' : 'neutral'"
                :variant="isMuted ? 'soft' : 'ghost'"
                size="sm"
                @click="toggleMute()"
              />
              <UButton
                :icon="isOnHold ? 'i-lucide-play' : 'i-lucide-pause'"
                :color="isOnHold ? 'warning' : 'neutral'"
                :variant="isOnHold ? 'soft' : 'ghost'"
                size="sm"
                @click="toggleHold()"
              />
              <UButton
                icon="i-lucide-grid-3x3"
                color="neutral"
                :variant="showInCallDtmf ? 'soft' : 'ghost'"
                size="sm"
                @click="showInCallDtmf = !showInCallDtmf"
              />
              <UButton
                icon="i-lucide-phone-forwarded"
                color="info"
                variant="ghost"
                size="sm"
                @click="transferOpen = true"
              />
            </div>

            <!-- In-call DTMF pad -->
            <div v-if="showInCallDtmf" class="mb-2.5">
              <SoftphoneDialpad @press="onInCallDtmf($event)" />
            </div>
          </template>

          <!-- RINGING IN -->
          <template v-else-if="callState === 'ringing-in'">
            <div class="text-center py-4">
              <UIcon name="i-lucide-phone-incoming" class="size-7 text-(--ui-success) mx-auto mb-2 animate-pulse" />
              <p class="text-sm font-medium text-(--ui-text-highlighted)">Incoming Call</p>
              <p class="text-sm font-mono text-(--ui-text-muted)">{{ remoteNumber }}</p>
              <div class="flex gap-2 justify-center mt-3">
                <UButton icon="i-lucide-phone" color="success" size="sm" label="Answer" @click="answer()" />
                <UButton icon="i-lucide-phone-off" color="error" variant="soft" size="sm" label="Reject" @click="reject()" />
              </div>
            </div>
          </template>
        </div>

        <!-- Hangup button -->
        <div v-if="callState !== 'idle' && !showSetup" class="px-3 pb-2.5">
          <UButton
            icon="i-lucide-phone-off"
            label="Hang Up"
            color="error"
            class="w-full justify-center"
            size="sm"
            @click="hangup()"
          />
        </div>
      </div>
    </Transition>
  </div>

  <!-- Transfer Modal -->
  <TransferModal v-model:open="transferOpen" @select="doTransfer" />
</template>

<script setup lang="ts">
import {
  playDtmfTone, startRingback, stopRingback,
  startRingtone, stopRingtone, stopAllTones,
} from "~/composables/useSoftphoneTones";

const {
  regState, regError, callState, callDirection, remoteNumber, callStartTime,
  isMuted, isOnHold, activeAccountIdx, config, micError,
  init, switchAccount, dial, answer, reject, hangup, toggleMute, toggleHold, sendDTMF, transfer, dispose,
} = useSoftphone();

const expanded = ref(false);
const showDialpad = ref(false);
const showInCallDtmf = ref(false);
const dialNumber = ref("");
const transferOpen = ref(false);

// ── Setup form ──

const showSetup = ref(false);
const showHint = ref(false);
const showCodecs = ref(false);
const setupSaving = ref(false);
const setupError = ref("");
const AUDIO_CODECS = ["opus", "PCMU", "PCMA", "G722"];

const setup = reactive({
  wsUrl: "",
  domain: "",
  stunServer: "stun:stun.l.google.com:19302",
  codecs: [...AUDIO_CODECS] as string[],
  accounts: [{ extension: "", password: "", label: "" }] as { extension: string; password: string; label: string }[],
});

const unusedCodecs = computed(() => AUDIO_CODECS.filter((c) => !setup.codecs.includes(c)));

function moveCodec(index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= setup.codecs.length) return;
  const tmp = setup.codecs[index]!;
  setup.codecs[index] = setup.codecs[target]!;
  setup.codecs[target] = tmp;
}

async function openSetup() {
  setupError.value = "";
  showSetup.value = true;

  // Always fetch fresh config from server
  try {
    const fresh = await $fetch<any>("/api/softphone/config");
    config.value = fresh;
  } catch {}

  // Pre-fill from config
  if (config.value) {
    setup.wsUrl = config.value.wsUrl || "";
    setup.domain = config.value.domain || "";
    setup.stunServer = config.value.stunServer || "stun:stun.l.google.com:19302";
    setup.codecs = config.value.codecs?.filter((c: string) => c.toLowerCase() !== "telephone-event") || [...AUDIO_CODECS];
    setup.accounts = config.value.accounts?.length
      ? config.value.accounts.map((a: any) => ({ ...a }))
      : [{ extension: "", password: "", label: "" }];
  }
}

function addSetupAccount() {
  setup.accounts.push({ extension: "", password: "", label: "" });
}

async function saveSetup() {
  setupError.value = "";
  setupSaving.value = true;

  try {
    await $fetch("/api/softphone/config", {
      method: "PUT",
      body: {
        wsUrl: setup.wsUrl,
        domain: setup.domain,
        stunServer: setup.stunServer,
        codecs: [...setup.codecs, "telephone-event"],
        accounts: setup.accounts.filter((a) => a.extension.trim()),
      },
    });

    // Reconnect and wait for registration result
    await dispose();
    await init();

    // Wait for regState to settle (registered or error), up to 8s
    const result = await new Promise<string>((done) => {
      if (regState.value === "registered" || regState.value === "error") return done(regState.value);
      const stop = watch(regState, (v) => {
        if (v === "registered" || v === "error") { stop(); done(v); }
      });
      setTimeout(() => { stop(); done(regState.value); }, 8000);
    });

    if (result === "registered") {
      showSetup.value = false;
    } else {
      setupError.value = regError.value || "Registration failed — check credentials and WebSocket URL";
    }
  } catch (err: any) {
    setupError.value = err.data?.message || err.message || "Save failed";
  } finally {
    setupSaving.value = false;
  }
}

// ── Registration display ──

const regLabel = computed(() => {
  switch (regState.value) {
    case "registered": return "Online";
    case "registering": return "Connecting...";
    case "error": return "Error";
    default: return "Offline";
  }
});

const regColor = computed(() => {
  switch (regState.value) {
    case "registered": return "success";
    case "registering": return "warning";
    case "error": return "error";
    default: return "neutral";
  }
});

// ── Account display ──

const currentAccountLabel = computed(() => {
  if (!config.value?.configured) return "Not configured";
  const accounts = config.value?.accounts;
  if (!accounts?.length) return "No account";
  return accounts[activeAccountIdx.value]?.label || accounts[activeAccountIdx.value]?.extension || "—";
});

// ── Call status display ──

const callStatusLabel = computed(() => {
  switch (callState.value) {
    case "ringing-in": return "Ringing";
    case "ringing-out": return "Calling";
    case "connected": return "In Call";
    case "holding": return "On Hold";
    default: return "";
  }
});

const callStatusColor = computed(() => {
  switch (callState.value) {
    case "ringing-in": return "success";
    case "ringing-out": return "info";
    case "connected": return "success";
    case "holding": return "warning";
    default: return "neutral";
  }
});

// ── Live call duration ──

const liveDuration = ref("0:00");
let durationTimer: ReturnType<typeof setInterval> | null = null;

function updateDuration() {
  if (!callStartTime.value) {
    liveDuration.value = "0:00";
    return;
  }
  const seconds = Math.floor((Date.now() - callStartTime.value) / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  liveDuration.value = `${m}:${s.toString().padStart(2, "0")}`;
}

watch(callState, (state) => {
  // Stop all tones first, then start the appropriate one
  stopAllTones();

  if (state === "connected") {
    updateDuration();
    durationTimer = setInterval(updateDuration, 1000);
  } else {
    if (durationTimer) { clearInterval(durationTimer); durationTimer = null; }
    liveDuration.value = "0:00";
  }

  // Ringback tone when dialing out
  if (state === "ringing-out") startRingback();

  // Ringtone when receiving a call
  if (state === "ringing-in") {
    startRingtone();
    expanded.value = true;
  }
});

onUnmounted(() => {
  if (durationTimer) clearInterval(durationTimer);
  stopAllTones();
});

// ── Dialpad input ──

function onDialpadPress(digit: string) {
  playDtmfTone(digit);
  if (callState.value === "idle") {
    dialNumber.value += digit;
  }
}

// ── In-call DTMF with tone ──

function onInCallDtmf(digit: string) {
  playDtmfTone(digit);
  sendDTMF(digit);
}

// ── Transfer ──

function doTransfer(endpoint: string) {
  transfer(endpoint);
}
</script>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.2s ease;
}
.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

.fade-scale-enter-active,
.fade-scale-leave-active {
  transition: all 0.15s ease;
}
.fade-scale-enter-from,
.fade-scale-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
