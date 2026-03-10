<template>
  <div class="min-h-screen bg-(--ui-bg) flex justify-center p-6 pt-[6vh]">
    <div class="setup-container w-full flex flex-col items-center" :class="step === 0 && !showAutoConfig ? 'max-w-5xl' : 'max-w-2xl'">
      <!-- Header -->
      <header class="text-center mb-8">
        <div class="flex items-center justify-center gap-3 mb-1">
          <div class="bg-(--ui-primary)/10 p-2 rounded-xl flex">
            <UIcon name="i-lucide-radio" class="size-8 text-(--ui-primary)" />
          </div>
          <h1 class="text-3xl font-bold tracking-tight text-(--ui-text-highlighted)">AriLink</h1>
        </div>
        <p class="text-(--ui-text-muted) font-medium uppercase tracking-[0.2em] text-[10px]">Setup Wizard</p>
      </header>

      <UCard class="w-full shadow-2xl !rounded-2xl overflow-hidden">
        <template #header>
          <div class="flex items-center justify-between flex-wrap gap-2">
            <h2 class="text-sm font-semibold text-(--ui-text-muted) uppercase tracking-wider">
              {{ showAutoConfig && step === 0 ? 'Auto-Configure' : `Step ${step + 1}: ${stepLabels[step]}` }}
            </h2>
            <!-- Step indicator (hidden only on auto-configure form) -->
            <div v-if="!(showAutoConfig && step === 0)" class="flex gap-1.5">
              <button
                v-for="(s, i) in stepLabels"
                :key="i"
                class="w-6 h-6 flex items-center justify-center rounded text-[10px] transition-all"
                :class="step === i
                  ? 'bg-(--ui-primary) text-black font-bold'
                  : i <= maxReachableStep
                    ? 'bg-(--ui-bg-elevated) text-(--ui-text-muted) hover:text-(--ui-text) font-medium'
                    : 'bg-(--ui-bg-elevated) text-(--ui-text-dimmed) cursor-not-allowed font-medium'"
                :disabled="i > maxReachableStep"
                @click="i <= maxReachableStep && (step = i)"
              >
                {{ i + 1 }}
              </button>
            </div>
            <!-- Close button during auto-configure -->
            <UButton
              v-if="showAutoConfig && step === 6"
              label="Close"
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="sm"
              @click="showAutoConfig = false; step = 0"
            />
          </div>
        </template>

        <Transition name="step" mode="out-in">
        <!-- ═══ Step 0: Welcome ═══ -->
        <div v-if="step === 0" key="0" class="space-y-6">

          <!-- ── Auto-Configure Panel ── -->
          <template v-if="showAutoConfig">
            <div class="space-y-4 text-left">
              <div class="flex items-center gap-2">
                <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="xs" @click="showAutoConfig = false" :disabled="autoConfig.running" />
                <UIcon name="i-lucide-wand-sparkles" class="size-5 text-(--ui-primary)" />
                <h2 class="text-lg font-semibold text-(--ui-text-highlighted)">Auto-Configure PBX</h2>
              </div>
              <p class="text-sm text-(--ui-text-muted)">
                Enter your PBX's SSH credentials and your server's IP. AriLink will SSH in and configure everything automatically.
              </p>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <UFormField label="PBX Host (SSH)" :error="autoConfig.formTouched && !autoConfig.sshHost ? 'Required' : undefined">
                  <UInput v-model="autoConfig.sshHost" placeholder="192.168.1.100" icon="i-lucide-server" :disabled="autoConfig.running" />
                </UFormField>
                <UFormField label="SSH Port">
                  <UInput v-model="autoConfig.sshPort" placeholder="22" icon="i-lucide-hash" :disabled="autoConfig.running" />
                </UFormField>
                <UFormField label="SSH Username" :error="autoConfig.formTouched && !autoConfig.sshUser ? 'Required' : undefined">
                  <UInput v-model="autoConfig.sshUser" placeholder="root" icon="i-lucide-user" :disabled="autoConfig.running" />
                </UFormField>
                <UFormField label="SSH Password" :error="autoConfig.formTouched && !autoConfig.sshPassword ? 'Required' : undefined">
                  <UInput v-model="autoConfig.sshPassword" type="password" placeholder="password" icon="i-lucide-lock" :disabled="autoConfig.running" />
                </UFormField>
                <UFormField label="This Server's IP" :error="autoConfig.formTouched && !autoConfig.listenerIp ? 'Required' : undefined">
                  <UInput v-model="autoConfig.listenerIp" placeholder="192.168.1.50" icon="i-lucide-radio" :disabled="autoConfig.running" />
                  <div v-if="autoConfig.detectedIps.length > 1" class="flex flex-wrap gap-1 mt-1">
                    <button
                      v-for="ip in autoConfig.detectedIps"
                      :key="ip"
                      class="text-xs px-1.5 py-0.5 rounded bg-(--ui-bg-elevated) text-(--ui-text-muted) hover:text-(--ui-text) transition-colors"
                      :class="autoConfig.listenerIp === ip ? 'ring-1 ring-(--ui-primary) text-(--ui-primary)' : ''"
                      @click="autoConfig.listenerIp = ip"
                    >
                      {{ ip }}
                    </button>
                  </div>
                </UFormField>
                <UFormField label="Stasis App Name">
                  <UInput v-model="autoConfig.stasisApp" placeholder="stasis-app" icon="i-lucide-app-window" :disabled="autoConfig.running" />
                </UFormField>
                <UFormField label="Inbound DID(s)" class="sm:col-span-2">
                  <UInput v-model="autoConfig.inboundDid" placeholder="Leave empty to route all calls" icon="i-lucide-phone-incoming" :disabled="autoConfig.running" />
                  <p class="text-xs text-(--ui-text-dimmed) mt-1">Specific number to route (e.g. 31612345678). Leave empty for all incoming calls.</p>
                </UFormField>
              </div>

              <!-- Action buttons -->
              <div class="flex items-center gap-2">
                <UButton
                  v-if="!autoConfig.done && !autoConfig.running"
                  label="Start Auto-Configure"
                  icon="i-lucide-play"
                  color="primary"
                  @click="startAutoConfig"
                />
                <UButton
                  v-if="autoConfig.running"
                  label="Cancel"
                  icon="i-lucide-x"
                  color="neutral"
                  variant="outline"
                  @click="cancelAutoConfig"
                />
              </div>

              <!-- Progress Steps -->
              <div v-if="autoConfig.steps.length > 0" class="space-y-1.5">
                <div
                  v-for="s in autoConfig.steps"
                  :key="s.id"
                  class="flex items-start gap-2 p-2 rounded-lg"
                  :class="s.status === 'failed' ? 'bg-red-500/5' : s.status === 'done' ? 'bg-green-500/5' : 'bg-amber-500/5'"
                >
                  <UIcon
                    :name="s.status === 'done' ? 'i-lucide-check-circle' : s.status === 'skipped' ? 'i-lucide-minus-circle' : 'i-lucide-x-circle'"
                    :class="s.status === 'done' ? 'text-green-500' : s.status === 'skipped' ? 'text-amber-500' : 'text-red-500'"
                    class="size-4 shrink-0 mt-0.5"
                  />
                  <div>
                    <p class="text-sm font-medium text-(--ui-text-highlighted)">{{ s.label }}</p>
                    <p v-if="s.detail" class="text-xs text-(--ui-text-muted)">{{ s.detail }}</p>
                  </div>
                </div>
              </div>

              <!-- Spinner while running -->
              <div v-if="autoConfig.running && autoConfig.steps.length > 0" class="flex items-center gap-2 text-sm text-(--ui-text-muted)">
                <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
                <span>Configuring...</span>
              </div>

              <!-- Error with retry -->
              <div v-if="autoConfig.error" class="space-y-2">
                <div class="flex items-center gap-2 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                  <UIcon name="i-lucide-alert-circle" class="size-4 text-red-500 shrink-0" />
                  <p class="text-sm text-(--ui-text)">{{ autoConfig.error }}</p>
                </div>
                <UButton
                  label="Retry"
                  icon="i-lucide-refresh-cw"
                  color="primary"
                  variant="soft"
                  @click="retryAutoConfig"
                />
              </div>

              <!-- Done — go to finish -->
              <div v-if="autoConfig.done && !autoConfig.error" class="text-center space-y-3 pt-2">
                <div class="flex items-center justify-center gap-2 text-green-500">
                  <UIcon name="i-lucide-check-circle" class="size-5" />
                  <span class="text-sm font-semibold">PBX configured successfully</span>
                </div>
                <UButton
                  label="Continue to Finish"
                  icon="i-lucide-arrow-right"
                  trailing
                  color="primary"
                  size="lg"
                  @click="step = 6"
                />
              </div>
            </div>
          </template>

          <!-- ── Normal Welcome ── -->
          <template v-else>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start">
              <!-- Left: Welcome text + CTA -->
              <div class="flex flex-col justify-center h-full space-y-8">
                <div>
                  <div class="inline-flex items-center justify-center p-3 mb-6 bg-(--ui-primary)/10 rounded-2xl">
                    <UIcon name="i-lucide-wand-sparkles" class="size-10 text-(--ui-primary)" />
                  </div>
                  <h3 class="text-3xl font-bold mb-4 text-(--ui-text-highlighted) tracking-tight">Welcome to AriLink</h3>
                  <p class="text-(--ui-text-muted) text-lg leading-relaxed">
                    This wizard will connect AriLink to your Asterisk or FreePBX server seamlessly. We'll guide you through the configuration process — no prior ARI experience required.
                  </p>
                </div>
                <div>
                  <UButton
                    label="Get Started"
                    icon="i-lucide-arrow-right"
                    trailing
                    color="primary"
                    size="xl"
                    class="w-full sm:w-auto shadow-lg"
                    @click="step = 1"
                  />
                </div>
              </div>

              <!-- Right: Environment selector + Prerequisites -->
              <div class="flex flex-col gap-6">
                <!-- Environment selector -->
                <div class="bg-(--ui-bg-elevated)/50 border border-(--ui-border) rounded-xl p-6">
                  <p class="text-[10px] uppercase tracking-widest font-bold text-(--ui-text-dimmed) mb-4">Select your environment</p>
                  <div class="grid grid-cols-1 gap-3">
                    <button
                      class="flex items-center text-left p-3 rounded-lg border transition-all group"
                      :class="form.pbxType === 'freepbx'
                        ? 'border-(--ui-primary) bg-(--ui-primary)/5'
                        : 'border-(--ui-border) hover:border-(--ui-text-dimmed)'"
                      @click="form.pbxType = 'freepbx'"
                    >
                      <div class="p-2 rounded-md mr-3 shrink-0" :class="form.pbxType === 'freepbx' ? 'bg-(--ui-primary)/20' : 'bg-(--ui-bg-elevated)'">
                        <UIcon name="i-lucide-layout-dashboard" class="size-5" :class="form.pbxType === 'freepbx' ? 'text-(--ui-primary)' : 'text-(--ui-text-muted)'" />
                      </div>
                      <div>
                        <p class="font-bold text-sm text-(--ui-text-highlighted)">FreePBX</p>
                        <p class="text-[11px] text-(--ui-text-muted)">Asterisk with FreePBX GUI</p>
                      </div>
                      <div v-if="form.pbxType === 'freepbx'" class="ml-auto">
                        <UIcon name="i-lucide-check-circle-2" class="size-5 text-(--ui-primary)" />
                      </div>
                    </button>
                    <button
                      class="flex items-center text-left p-3 rounded-lg border transition-all group"
                      :class="form.pbxType === 'asterisk'
                        ? 'border-(--ui-primary) bg-(--ui-primary)/5'
                        : 'border-(--ui-border) hover:border-(--ui-text-dimmed) opacity-70 hover:opacity-100'"
                      @click="form.pbxType = 'asterisk'"
                    >
                      <div class="p-2 rounded-md mr-3 shrink-0" :class="form.pbxType === 'asterisk' ? 'bg-(--ui-primary)/20' : 'bg-(--ui-bg-elevated)'">
                        <UIcon name="i-lucide-terminal" class="size-5" :class="form.pbxType === 'asterisk' ? 'text-(--ui-primary)' : 'text-(--ui-text-muted)'" />
                      </div>
                      <div>
                        <p class="font-bold text-sm text-(--ui-text-highlighted)">Plain Asterisk</p>
                        <p class="text-[11px] text-(--ui-text-muted)">Asterisk without GUI</p>
                      </div>
                      <div v-if="form.pbxType === 'asterisk'" class="ml-auto">
                        <UIcon name="i-lucide-check-circle-2" class="size-5 text-(--ui-primary)" />
                      </div>
                    </button>
                  </div>
                </div>

                <!-- Prerequisites -->
                <div class="bg-(--ui-bg-elevated)/50 border border-(--ui-border) rounded-xl p-6">
                  <p class="text-[10px] uppercase tracking-widest font-bold text-(--ui-text-dimmed) mb-4">Prerequisites</p>
                  <ul class="space-y-3">
                    <li class="flex items-start gap-3 text-sm text-(--ui-text)">
                      <UIcon name="i-lucide-check-circle-2" class="size-5 text-(--ui-primary) shrink-0 mt-0.5" />
                      <span>{{ form.pbxType === 'freepbx' ? 'FreePBX' : 'Asterisk' }} installed and running</span>
                    </li>
                    <li class="flex items-start gap-3 text-sm text-(--ui-text)">
                      <UIcon name="i-lucide-check-circle-2" class="size-5 text-(--ui-primary) shrink-0 mt-0.5" />
                      <span>{{ form.pbxType === 'freepbx' ? 'Web access to admin panel' : 'Config file access (/etc/asterisk/)' }}</span>
                    </li>
                    <li class="flex items-start gap-3 text-sm text-(--ui-text)">
                      <UIcon name="i-lucide-check-circle-2" class="size-5 text-(--ui-primary) shrink-0 mt-0.5" />
                      <span>SSH / console access available</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <!-- Pro tiers + License — bottom section -->
            <div class="border-t border-(--ui-border) mt-8 pt-6">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <component
                  :is="isTierUnlocked(tier.id) ? 'div' : 'a'"
                  v-for="tier in PRO_TIERS"
                  :key="tier.id"
                  v-bind="isTierUnlocked(tier.id) ? {} : { href: SPONSOR_URL, target: '_blank' }"
                  class="group flex items-center p-4 rounded-xl border transition-colors"
                  :class="isTierUnlocked(tier.id)
                    ? 'border-green-500/30 bg-green-500/5'
                    : 'border-(--ui-border) hover:bg-(--ui-bg-elevated)/50'"
                >
                  <div class="w-10 h-10 flex items-center justify-center rounded-lg mr-4 shrink-0"
                    :class="tier.id === 'pro-pack' ? 'bg-amber-500/10' : 'bg-purple-500/10'"
                  >
                    <UIcon :name="tier.icon" class="size-5" :class="tier.id === 'pro-pack' ? 'text-amber-400' : 'text-purple-400'" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between mb-0.5">
                      <p class="text-sm font-bold text-(--ui-text-highlighted) truncate">{{ tier.label }}</p>
                      <span class="text-xs font-mono font-bold ml-2" :class="tier.id === 'pro-pack' ? 'text-amber-400' : 'text-purple-400'">
                        {{ isTierUnlocked(tier.id) ? 'Unlocked' : tier.price }}
                      </span>
                    </div>
                    <p class="text-xs text-(--ui-text-muted) truncate">{{ tier.description }}</p>
                  </div>
                  <UButton
                    v-if="isTierUnlocked(tier.id) && tier.id === 'pro-pack'"
                    icon="i-lucide-play"
                    color="success"
                    variant="soft"
                    size="xs"
                    class="ml-3"
                    @click.prevent="showAutoConfig = true"
                  />
                  <UIcon v-else name="i-lucide-chevron-right" class="size-5 text-(--ui-text-dimmed) ml-3 group-hover:translate-x-1 transition-transform" />
                </component>
              </div>

              <!-- License key -->
              <div v-if="!proActive" class="flex flex-col md:flex-row items-center justify-center gap-4">
                <span class="text-xs text-(--ui-text-muted) font-medium">Already have a license key?</span>
                <div class="flex gap-2 w-full md:w-auto md:min-w-[400px]">
                  <UInput
                    v-model="licenseKey"
                    placeholder="ARILINK-XXXX-XXXX-XXXX"
                    size="sm"
                    class="flex-1 font-mono"
                    :color="licenseError ? 'error' : undefined"
                  />
                  <UButton
                    label="Activate License"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    :loading="licenseActivating"
                    :disabled="!licenseKey.trim()"
                    @click="activateLicense"
                  />
                </div>
              </div>
              <p v-if="licenseError" class="text-xs text-(--ui-error) text-center mt-2">{{ licenseError }}</p>
            </div>
          </template>
        </div>

        <!-- ═══ Step 1: Firewall ═══ -->
        <div v-else-if="step === 1" key="1" class="space-y-6">
          <section class="space-y-4">
            <div class="flex items-center gap-2 pb-2 border-b border-(--ui-border)">
              <UIcon name="i-lucide-shield" class="size-4 text-(--ui-primary)" />
              <h4 class="text-sm font-bold uppercase tracking-wider text-(--ui-text-muted)">Firewall & Whitelist</h4>
            </div>

            <p class="text-sm text-(--ui-text-muted)">
              Before connecting, make sure your {{ form.pbxType === 'freepbx' ? 'FreePBX firewall' : 'Asterisk server firewall' }} allows this server to reach the PBX.
              Without this, the connection test in the next step will time out.
            </p>

            <!-- FreePBX version -->
            <template v-if="form.pbxType === 'freepbx'">
              <div class="rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) p-3 space-y-2">
                <div class="flex items-center gap-2">
                  <span class="flex items-center justify-center size-5 rounded-full bg-(--ui-primary) text-white text-xs font-bold shrink-0">1</span>
                  <p class="text-sm font-medium text-(--ui-text-highlighted)">Add this server to Trusted Networks</p>
                </div>
                <p class="text-xs text-(--ui-text-muted) pl-7">
                  Go to <strong>Admin → Firewall → Networks</strong>. Click <strong>Add Network</strong>, enter this server's IP address, set zone to <strong>Trusted</strong>, and click <strong>Save</strong>.
                </p>
                <p class="text-xs text-(--ui-text-dimmed) pl-7">
                  This opens all required ports (8088, 5060, 10000–20000) for this server.
                </p>
              </div>

              <div class="rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) p-3 space-y-2">
                <div class="flex items-center gap-2">
                  <span class="flex items-center justify-center size-5 rounded-full bg-(--ui-primary) text-white text-xs font-bold shrink-0">2</span>
                  <p class="text-sm font-medium text-(--ui-text-highlighted)">Whitelist in Intrusion Detection (fail2ban)</p>
                </div>
                <p class="text-xs text-(--ui-text-muted) pl-7">
                  Go to <strong>Admin → Firewall → Intrusion Detection</strong>. Type this server's IP in the <strong>Custom Whitelist</strong> field and click <strong>Save</strong>.
                  This permanently prevents fail2ban from banning this server.
                </p>
                <p class="text-xs text-(--ui-text-dimmed) pl-7">
                  The firewall and fail2ban are separate systems — whitelisting in one does NOT whitelist in the other. You need both.
                </p>
              </div>

              <div class="rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) p-3 space-y-2">
                <div class="flex items-center gap-2">
                  <span class="flex items-center justify-center size-5 rounded-full bg-(--ui-primary) text-white text-xs font-bold shrink-0">3</span>
                  <p class="text-sm font-medium text-(--ui-text-highlighted)">Apply Config</p>
                </div>
                <p class="text-xs text-(--ui-text-muted) pl-7">
                  Click the red <strong>Apply Config</strong> button at the top of the FreePBX page to activate your changes.
                </p>
              </div>
            </template>

            <!-- Plain Asterisk version -->
            <template v-else>
              <div class="rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) p-3 space-y-3">
                <div class="flex items-center gap-2">
                  <span class="flex items-center justify-center size-5 rounded-full bg-(--ui-primary) text-white text-xs font-bold shrink-0">1</span>
                  <p class="text-sm font-medium text-(--ui-text-highlighted)">Open required ports</p>
                </div>
                <pre class="text-xs bg-(--ui-bg) rounded p-2 overflow-x-auto ml-7"><code>iptables -A INPUT -s YOUR_SERVER_IP -p tcp --dport 8088 -j ACCEPT
iptables -A INPUT -s YOUR_SERVER_IP -p udp --dport 5060 -j ACCEPT
iptables -A INPUT -s YOUR_SERVER_IP -p udp --dport 10000:20000 -j ACCEPT</code></pre>
              </div>

              <div class="rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) p-3 space-y-3">
                <div class="flex items-center gap-2">
                  <span class="flex items-center justify-center size-5 rounded-full bg-(--ui-primary) text-white text-xs font-bold shrink-0">2</span>
                  <p class="text-sm font-medium text-(--ui-text-highlighted)">Whitelist in fail2ban</p>
                </div>
                <div class="ml-7 space-y-2">
                  <pre class="text-xs bg-(--ui-bg) rounded p-2 overflow-x-auto"><code>sudo nano /etc/fail2ban/jail.local</code></pre>
                  <p class="text-xs text-(--ui-text-muted)">Add under <code class="px-1 py-0.5 rounded bg-(--ui-bg-elevated) text-(--ui-text)">[DEFAULT]</code>:</p>
                  <pre class="text-xs bg-(--ui-bg) rounded p-2 overflow-x-auto"><code>ignoreip = 127.0.0.1/8 YOUR_SERVER_IP</code></pre>
                  <p class="text-xs text-(--ui-text-muted)">Then restart:</p>
                  <pre class="text-xs bg-(--ui-bg) rounded p-2 overflow-x-auto"><code>systemctl restart fail2ban</code></pre>
                </div>
              </div>
            </template>

            <!-- Required ports info (both versions) -->
            <details class="group rounded-lg border border-(--ui-border) overflow-hidden">
              <summary class="flex items-center gap-2 p-3 cursor-pointer text-sm font-medium text-(--ui-text) hover:bg-(--ui-bg-elevated) transition-colors">
                <UIcon name="i-lucide-help-circle" class="size-4 text-(--ui-primary) shrink-0" />
                What ports does AriLink need?
                <UIcon name="i-lucide-chevron-down" class="size-4 text-(--ui-text-dimmed) ml-auto transition-transform group-open:rotate-180" />
              </summary>
              <div class="p-3 pt-0 space-y-2 text-xs text-(--ui-text-muted)">
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-network" class="size-4 text-(--ui-primary) shrink-0" />
                  <span><strong>8088/TCP</strong> — ARI HTTP (REST API connection to Asterisk)</span>
                </div>
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-network" class="size-4 text-(--ui-primary) shrink-0" />
                  <span><strong>5060/UDP</strong> — SIP Signaling (call setup)</span>
                </div>
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-network" class="size-4 text-(--ui-primary) shrink-0" />
                  <span><strong>10000–20000/UDP</strong> — RTP Audio (voice data)</span>
                </div>
              </div>
            </details>

          </section>

          <div class="flex justify-between">
            <UButton label="Back" icon="i-lucide-arrow-left" color="neutral" variant="ghost" @click="step = 0" />
            <UButton
              label="Next"
              icon="i-lucide-arrow-right"
              trailing
              color="primary"
              @click="step = 2"
            />
          </div>
        </div>

        <!-- ═══ Step 2: PBX Connection ═══ -->
        <div v-else-if="step === 2" key="2" class="space-y-6">
          <section class="space-y-4">
            <div class="flex items-center gap-2 pb-2 border-b border-(--ui-border)">
              <UIcon name="i-lucide-server" class="size-4 text-(--ui-primary)" />
              <h4 class="text-sm font-bold uppercase tracking-wider text-(--ui-text-muted)">PBX Connection</h4>
            </div>

            <p class="text-sm text-(--ui-text-muted)">
              AriLink connects to your PBX via ARI (Asterisk REST Interface). Enter the ARI user credentials you created in FreePBX.
            </p>

            <!-- Help: How to create ARI user -->
            <details class="group rounded-lg border border-(--ui-border) overflow-hidden">
              <summary class="flex items-center gap-2 p-3 cursor-pointer text-sm font-medium text-(--ui-text) hover:bg-(--ui-bg-elevated) transition-colors">
                <UIcon name="i-lucide-help-circle" class="size-4 text-(--ui-primary) shrink-0" />
                Don't have an ARI user yet? Click here for instructions
                <UIcon name="i-lucide-chevron-down" class="size-4 text-(--ui-text-dimmed) ml-auto transition-transform group-open:rotate-180" />
              </summary>
              <div class="p-3 pt-0 space-y-3 text-sm text-(--ui-text-muted)">
                <!-- FreePBX GUI instructions -->
                <template v-if="form.pbxType === 'freepbx'">
                  <div class="space-y-2">
                    <p class="font-medium text-(--ui-text)">1. Create an ARI user:</p>
                    <p>Go to <strong>Settings → Asterisk REST Interface Users → Add User</strong></p>
                    <ul class="list-disc pl-5 space-y-1 text-xs">
                      <li>Username: <code class="px-1 py-0.5 rounded bg-(--ui-bg-elevated) text-(--ui-text)">asterisk-ari</code> (or any name)</li>
                      <li>Password: use <strong>alphanumeric only</strong> (special chars can break FreePBX config)</li>
                      <li>Read-Only: <strong>No</strong></li>
                      <li>Click <strong>Submit</strong>, then <strong>Apply Config</strong></li>
                    </ul>
                  </div>
                  <div class="space-y-2">
                    <p class="font-medium text-(--ui-text)">2. Enable HTTP &amp; ARI in Advanced Settings:</p>
                    <p>Go to <strong>Settings → Advanced Settings</strong>, find these sections:</p>
                    <p class="text-xs font-medium text-(--ui-text) mt-2">Asterisk Builtin mini-HTTP server:</p>
                    <ul class="list-disc pl-5 space-y-1 text-xs">
                      <li><strong>Enable the mini-HTTP Server</strong> → <strong>Yes</strong></li>
                      <li><strong>HTTP Bind Address</strong> → <code class="px-1 py-0.5 rounded bg-(--ui-bg-elevated) text-(--ui-text)">0.0.0.0</code></li>
                      <li><strong>HTTP Bind Port</strong> → <code class="px-1 py-0.5 rounded bg-(--ui-bg-elevated) text-(--ui-text)">8088</code></li>
                    </ul>
                    <p class="text-xs font-medium text-(--ui-text) mt-2">Asterisk REST Interface:</p>
                    <ul class="list-disc pl-5 space-y-1 text-xs">
                      <li><strong>Enable the Asterisk REST Interface</strong> → <strong>Yes</strong></li>
                      <li><strong>Allowed Origins</strong> → <code class="px-1 py-0.5 rounded bg-(--ui-bg-elevated) text-(--ui-text)">*</code> (this is CORS only, not firewall)</li>
                      <li><strong>Pretty Print JSON Responses</strong> → <strong>Yes</strong></li>
                    </ul>
                    <p class="text-xs mt-1">Click <strong>Submit</strong>, then <strong>Apply Config</strong></p>
                  </div>
                </template>

                <!-- Plain Asterisk config file instructions -->
                <template v-else>
                  <div class="space-y-1 text-xs">
                    <p class="font-medium text-(--ui-text) text-sm">1. Create ARI user:</p>
                    <pre class="bg-(--ui-bg) rounded p-2 overflow-x-auto"><code>sudo nano /etc/asterisk/ari.conf</code></pre>
                    <p>Add:</p>
                    <pre class="bg-(--ui-bg) rounded p-2 overflow-x-auto"><code>[general]
enabled = yes
pretty = yes
allowed_origins = *

[asterisk-ari]
type = user
read_only = no
password = YOUR_PASSWORD</code></pre>
                  </div>
                  <div class="space-y-1 text-xs">
                    <p class="font-medium text-(--ui-text) text-sm">2. Enable HTTP server:</p>
                    <pre class="bg-(--ui-bg) rounded p-2 overflow-x-auto"><code>sudo nano /etc/asterisk/http.conf</code></pre>
                    <p>Set:</p>
                    <pre class="bg-(--ui-bg) rounded p-2 overflow-x-auto"><code>[general]
enabled = yes
bindaddr = 0.0.0.0
bindport = 8088</code></pre>
                  </div>
                  <div class="space-y-1 text-xs">
                    <p class="font-medium text-(--ui-text) text-sm">3. Reload:</p>
                    <pre class="bg-(--ui-bg) rounded p-2 overflow-x-auto"><code>asterisk -rx "module reload res_ari.so"
asterisk -rx "module reload res_http_websocket.so"</code></pre>
                  </div>
                </template>
              </div>
            </details>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <UFormField>
                <template #label><span class="inline-flex items-center gap-x-2">PBX IP Address <UTooltip :delay-duration="0" text="Your FreePBX server's IP (e.g. 192.168.1.100)"><UIcon name="i-lucide-info" class="size-3.5 text-(--ui-text-dimmed) cursor-help" /></UTooltip></span></template>
                <UInput v-model="form.PBX_IP" placeholder="192.168.1.100" icon="i-lucide-server" />
              </UFormField>
              <UFormField>
                <template #label><span class="inline-flex items-center gap-x-2">Stasis App Name <UTooltip :delay-duration="0" text="Must match your dialplan — usually 'stasis-app'"><UIcon name="i-lucide-info" class="size-3.5 text-(--ui-text-dimmed) cursor-help" /></UTooltip></span></template>
                <UInput v-model="form.STASIS_APP_NAME" placeholder="stasis-app" icon="i-lucide-app-window" />
              </UFormField>
              <UFormField>
                <template #label><span class="inline-flex items-center gap-x-2">ARI Username <UTooltip :delay-duration="0" text="The user you created in FreePBX ARI settings"><UIcon name="i-lucide-info" class="size-3.5 text-(--ui-text-dimmed) cursor-help" /></UTooltip></span></template>
                <UInput v-model="form.ASTERISK_LOGIN" placeholder="asterisk-ari" icon="i-lucide-user" />
              </UFormField>
              <UFormField>
                <template #label><span class="inline-flex items-center gap-x-2">ARI Password <UTooltip :delay-duration="0" text="Alphanumeric characters only"><UIcon name="i-lucide-info" class="size-3.5 text-(--ui-text-dimmed) cursor-help" /></UTooltip></span></template>
                <UInput v-model="form.ASTERISK_PASSWORD" :type="showPassword ? 'text' : 'password'" placeholder="password" icon="i-lucide-lock">
                  <template #trailing>
                    <UButton
                      :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      @click="showPassword = !showPassword"
                    />
                  </template>
                </UInput>
              </UFormField>
            </div>

            <!-- Test connection -->
            <div class="space-y-2">
              <div class="flex items-center gap-3">
                <UButton
                  label="Test Connection"
                  icon="i-lucide-plug"
                  color="primary"
                  variant="soft"
                  :loading="ariTesting"
                  :disabled="!form.PBX_IP || !form.ASTERISK_LOGIN || !form.ASTERISK_PASSWORD"
                  @click="testAri"
                />
                <UBadge v-if="ariResult" :color="ariResult.success ? 'success' : 'error'" variant="subtle">
                  <UIcon :name="ariResult.success ? 'i-lucide-check' : 'i-lucide-x'" class="size-3 mr-1" />
                  {{ ariResult.success ? ariResult.version : ariResult.error }}
                </UBadge>
              </div>
              <!-- Troubleshooting hint on failure -->
              <div v-if="ariResult && !ariResult.success && ariResult.hint" class="space-y-2">
                <div class="flex gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                  <UIcon name="i-lucide-lightbulb" class="size-4 text-amber-500 shrink-0 mt-0.5" />
                  <p class="text-xs text-(--ui-text-muted) leading-relaxed">{{ ariResult.hint }}</p>
                </div>

                <!-- fail2ban specific help -->
                <div v-if="ariResult.fail2ban" class="rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) p-3 space-y-3">
                  <div class="flex items-center gap-2">
                    <UIcon name="i-lucide-shield-alert" class="size-4 text-red-500 shrink-0" />
                    <p class="text-sm font-medium text-(--ui-text-highlighted)">Your IP may be banned by fail2ban</p>
                  </div>
                  <p class="text-xs text-(--ui-text-muted)">
                    Did you complete the Firewall step? If so, your IP may have been banned before you whitelisted it. SSH into your FreePBX server and unban:
                  </p>
                  <div class="space-y-2">
                    <div>
                      <p class="text-xs font-medium text-(--ui-text)">1. Check if your IP is banned:</p>
                      <pre class="text-xs bg-(--ui-bg) rounded p-2 overflow-x-auto mt-1"><code>fail2ban-client status asterisk</code></pre>
                    </div>
                    <div>
                      <p class="text-xs font-medium text-(--ui-text)">2. Unban your IP:</p>
                      <pre class="text-xs bg-(--ui-bg) rounded p-2 overflow-x-auto mt-1"><code>fail2ban-client set asterisk unbanip YOUR_SERVER_IP</code></pre>
                    </div>
                    <p class="text-xs text-(--ui-text-dimmed)">
                      After unbanning, try Test Connection again. Your whitelist from the previous step will prevent future bans.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div class="flex justify-between">
            <UButton label="Back" icon="i-lucide-arrow-left" color="neutral" variant="ghost" @click="step = 1" />
            <UButton
              label="Next"
              icon="i-lucide-arrow-right"
              trailing
              color="primary"
              :disabled="!ariResult?.success"
              @click="step = 3"
            />
          </div>
        </div>

        <!-- ═══ Step 3: Dialplan & Network ═══ -->
        <div v-else-if="step === 3" key="3" class="space-y-6">
          <section class="space-y-4">
            <div class="flex items-center gap-2 pb-2 border-b border-(--ui-border)">
              <UIcon name="i-lucide-route" class="size-4 text-(--ui-primary)" />
              <h4 class="text-sm font-bold uppercase tracking-wider text-(--ui-text-muted)">Dialplan & Network</h4>
            </div>

            <!-- Dialplan setup guide -->
            <div class="space-y-3">
              <p class="text-sm text-(--ui-text-muted)">
                AriLink needs a <strong>custom dialplan</strong> to receive incoming calls. This tells Asterisk to route calls to the Stasis app instead of ringing a phone.
              </p>

              <div class="rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) p-3 space-y-3">
                <div class="flex items-center gap-2">
                  <UIcon :name="form.pbxType === 'freepbx' ? 'i-lucide-settings' : 'i-lucide-terminal'" class="size-4 text-(--ui-primary) shrink-0" />
                  <p class="text-sm font-medium text-(--ui-text-highlighted)">
                    {{ form.pbxType === 'freepbx' ? 'In FreePBX GUI:' : 'Via SSH:' }}
                  </p>
                </div>
                <div v-if="form.pbxType === 'freepbx'" class="space-y-2 text-xs text-(--ui-text-muted)">
                  <p>Go to <strong>Settings → Dialplan Custom Extensions</strong> (or <strong>Admin → Config Edit → extensions_custom.conf</strong>)</p>
                  <p>Add this at the bottom:</p>
                </div>
                <div v-else class="space-y-2 text-xs text-(--ui-text-muted)">
                  <pre class="bg-(--ui-bg) rounded p-2 overflow-x-auto"><code>sudo nano /etc/asterisk/extensions_custom.conf</code></pre>
                  <p>Add this at the bottom of the file:</p>
                </div>
                <pre class="text-xs bg-(--ui-bg) rounded p-2 overflow-x-auto"><code>[from-trunk-custom]
exten => _X.,1,NoOp(AriLink — Incoming: $&#123;CALLERID(num)&#125; to $&#123;EXTEN&#125;)
 same => n,Stasis({{ form.STASIS_APP_NAME || 'stasis-app' }},$&#123;EXTEN&#125;,$&#123;CALLERID(num)&#125;)
 same => n,Hangup()</code></pre>
                <p class="text-xs text-(--ui-text-dimmed) mt-1">
                  <strong>Tip:</strong> To route only a specific DID, replace <code class="px-1 py-0.5 rounded bg-(--ui-bg-elevated)">_X.</code> with your number (e.g. <code class="px-1 py-0.5 rounded bg-(--ui-bg-elevated)">31612345678</code>).
                </p>
                <p v-if="form.pbxType === 'freepbx'" class="text-xs text-(--ui-text-muted)">Click <strong>Submit</strong>, then <strong>Apply Config</strong> at the top of the page.</p>
                <div v-else class="space-y-2 text-xs text-(--ui-text-muted)">
                  <p>Save the file, then reload the dialplan:</p>
                  <pre class="bg-(--ui-bg) rounded p-2 overflow-x-auto"><code>asterisk -rx "dialplan reload"</code></pre>
                </div>
              </div>
            </div>

            <!-- Network fields -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <UFormField>
                <template #label><span class="inline-flex items-center gap-x-2">Listener Server <UTooltip :delay-duration="0" text="This machine's IP — where AriLink is running"><UIcon name="i-lucide-info" class="size-3.5 text-(--ui-text-dimmed) cursor-help" /></UTooltip></span></template>
                <UInput v-model="form.LISTENER_SERVER" placeholder="192.168.1.50" icon="i-lucide-radio" />
              </UFormField>
              <UFormField>
                <template #label><span class="inline-flex items-center gap-x-2">External Host <UTooltip :delay-duration="0" text="Public IP — only if PBX is on a different network / behind NAT"><UIcon name="i-lucide-info" class="size-3.5 text-(--ui-text-dimmed) cursor-help" /></UTooltip></span></template>
                <UInput v-model="form.EXTERNAL_HOST" placeholder="Optional" icon="i-lucide-globe" />
              </UFormField>
            </div>

            <!-- NAT help -->
            <details class="group rounded-lg border border-(--ui-border) overflow-hidden">
              <summary class="flex items-center gap-2 p-3 cursor-pointer text-sm font-medium text-(--ui-text) hover:bg-(--ui-bg-elevated) transition-colors">
                <UIcon name="i-lucide-help-circle" class="size-4 text-(--ui-primary) shrink-0" />
                What are these fields? When do I need External Host?
                <UIcon name="i-lucide-chevron-down" class="size-4 text-(--ui-text-dimmed) ml-auto transition-transform group-open:rotate-180" />
              </summary>
              <div class="p-3 pt-0 space-y-2 text-xs text-(--ui-text-muted)">
                <p><strong>Listener Server</strong> = the IP address of this machine (where AriLink is running). Asterisk sends RTP audio here. Use your LAN IP if both are on the same network.</p>
                <p><strong>External Host</strong> = only needed if AriLink and FreePBX are on different networks (e.g. cloud VPS + office PBX). Set this to your public IP or domain. Also configure NAT in FreePBX: <strong>Settings → Asterisk SIP Settings → NAT Settings</strong>.</p>
              </div>
            </details>

          </section>

          <div class="flex justify-between">
            <UButton label="Back" icon="i-lucide-arrow-left" color="neutral" variant="ghost" @click="step = 2" />
            <UButton
              label="Next"
              icon="i-lucide-arrow-right"
              trailing
              color="primary"
              @click="step = 4"
            />
          </div>
        </div>

        <!-- ═══ Step 4: Transcription Service ═══ -->
        <div v-else-if="step === 4" key="4" class="space-y-6">
          <section class="space-y-4">
            <div class="flex items-center gap-2 pb-2 border-b border-(--ui-border)">
              <UIcon name="i-lucide-mic" class="size-4 text-(--ui-primary)" />
              <h4 class="text-sm font-bold uppercase tracking-wider text-(--ui-text-muted)">Transcription Service</h4>
            </div>

            <p class="text-sm text-(--ui-text-muted)">
              AriLink transcribes calls in real-time. Choose a transcription engine — <strong>Parakeet</strong> is recommended (free, local, 25 languages).
              You can skip this and configure it later.
            </p>

            <!-- Service type toggle -->
            <div class="flex items-center bg-(--ui-bg-elevated) rounded-lg p-0.5">
              <button
                v-for="opt in transcriptionOptions"
                :key="opt.value"
                class="flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all text-center"
                :class="form.transcriptionType === opt.value
                  ? 'bg-(--ui-bg) text-(--ui-text-highlighted) shadow-sm'
                  : 'text-(--ui-text-muted) hover:text-(--ui-text)'"
                @click="form.transcriptionType = opt.value as typeof form.transcriptionType"
              >
                {{ opt.label }}
              </button>
            </div>

            <!-- Parakeet / Whisper fields -->
            <template v-if="form.transcriptionType === 'parakeet' || form.transcriptionType === 'whisper'">
              <UFormField>
                <template #label><span class="inline-flex items-center gap-x-2">{{ form.transcriptionType === 'parakeet' ? 'Parakeet' : 'Whisper' }} Service URL <UTooltip :delay-duration="0" :text="form.transcriptionType === 'parakeet' ? 'Runs from transcription-services/parakeet-service/' : 'Runs from transcription-services/whisper-service/'"><UIcon name="i-lucide-info" class="size-3.5 text-(--ui-text-dimmed) cursor-help" /></UTooltip></span></template>
                <UInput v-model="form.TRANSCRIPTION_SERVICES" placeholder="ws://localhost:5000" icon="i-lucide-link" />
              </UFormField>
              <div class="flex items-center gap-3">
                <UButton
                  label="Test Service"
                  icon="i-lucide-plug"
                  color="primary"
                  variant="soft"
                  :loading="transcriptionTesting"
                  :disabled="!form.TRANSCRIPTION_SERVICES"
                  @click="testTranscription"
                />
                <UBadge v-if="transcriptionResult" :color="transcriptionResult.success ? 'success' : 'error'" variant="subtle">
                  <UIcon :name="transcriptionResult.success ? 'i-lucide-check' : 'i-lucide-x'" class="size-3 mr-1" />
                  {{ transcriptionResult.success ? 'Service reachable' : transcriptionResult.error }}
                </UBadge>
              </div>
            </template>

            <!-- Google fields -->
            <template v-if="form.transcriptionType === 'google'">
              <UFormField>
                <template #label><span class="inline-flex items-center gap-x-2">Service Account JSON <UTooltip :delay-duration="0" text="Paste the contents of your Google Cloud service account JSON key file"><UIcon name="i-lucide-info" class="size-3.5 text-(--ui-text-dimmed) cursor-help" /></UTooltip></span></template>
                <UTextarea v-model="googleJsonSetup" placeholder='Paste your Google service account JSON here...' :rows="4" class="font-mono text-xs" />
              </UFormField>
              <div v-if="googleSetupSummary" class="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/5 border border-green-500/20">
                <UIcon name="i-lucide-check-circle" class="size-4 text-green-500" />
                <span class="text-xs text-(--ui-text-muted)">{{ googleSetupSummary.projectId }} ({{ googleSetupSummary.clientEmail }})</span>
              </div>
              <div class="flex items-center gap-3">
                <UButton
                  label="Verify Credentials"
                  icon="i-lucide-plug"
                  color="primary"
                  variant="soft"
                  :loading="transcriptionTesting"
                  :disabled="!googleJsonSetup.trim()"
                  @click="testTranscription"
                />
                <UBadge v-if="transcriptionResult" :color="transcriptionResult.success ? 'success' : 'error'" variant="subtle">
                  <UIcon :name="transcriptionResult.success ? 'i-lucide-check' : 'i-lucide-x'" class="size-3 mr-1" />
                  {{ transcriptionResult.success ? 'Credentials valid' : transcriptionResult.error }}
                </UBadge>
              </div>
            </template>

            <!-- Skip info -->
            <p v-if="form.transcriptionType === 'skip'" class="text-sm text-(--ui-text-muted) py-2">
              You can configure transcription later in the Config page.
            </p>

          </section>

          <div class="flex justify-between">
            <UButton label="Back" icon="i-lucide-arrow-left" color="neutral" variant="ghost" @click="step = 3" />
            <UButton
              label="Next"
              icon="i-lucide-arrow-right"
              trailing
              color="primary"
              @click="step = 5"
            />
          </div>
        </div>

        <!-- ═══ Step 5: Extensions & Routing ═══ -->
        <div v-else-if="step === 5" key="5" class="space-y-6">
          <section class="space-y-4">
            <div class="flex items-center gap-2 pb-2 border-b border-(--ui-border)">
              <UIcon name="i-lucide-phone" class="size-4 text-(--ui-primary)" />
              <h4 class="text-sm font-bold uppercase tracking-wider text-(--ui-text-muted)">Extensions & Routing</h4>
            </div>

            <p class="text-sm text-(--ui-text-muted)">
              Fetch your PBX extensions to verify connectivity, and choose which assistant handles incoming calls. This step is optional — you can configure routing later.
            </p>

            <div class="flex items-center gap-3">
              <UButton
                label="Fetch Extensions"
                icon="i-lucide-download"
                color="primary"
                variant="soft"
                :loading="extensionsLoading"
                @click="fetchExtensions"
              />
              <span v-if="extensions.length > 0" class="text-sm text-(--ui-text-muted)">
                {{ extensions.length }} extension{{ extensions.length !== 1 ? 's' : '' }} found
              </span>
            </div>

            <!-- Extensions table -->
            <div v-if="extensions.length > 0" class="border border-(--ui-border) rounded-lg overflow-hidden">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-(--ui-border) bg-(--ui-bg-elevated)">
                    <th class="text-left py-2 px-3 text-(--ui-text-muted) font-medium">Extension</th>
                    <th class="text-left py-2 px-3 text-(--ui-text-muted) font-medium">State</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="ext in extensions.slice(0, 15)"
                    :key="ext.resource"
                    class="border-b border-(--ui-border) last:border-0"
                  >
                    <td class="py-1.5 px-3 font-mono text-(--ui-text)">{{ ext.resource }}</td>
                    <td class="py-1.5 px-3">
                      <UBadge
                        :label="ext.state"
                        :color="ext.state === 'online' ? 'success' : 'neutral'"
                        variant="subtle"
                        size="xs"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
              <div v-if="extensions.length > 15" class="px-3 py-2 text-xs text-(--ui-text-dimmed) bg-(--ui-bg-elevated) border-t border-(--ui-border)">
                ... and {{ extensions.length - 15 }} more
              </div>
            </div>

            <div v-if="extensionsError" class="flex items-center gap-2 text-sm text-(--ui-error)">
              <UIcon name="i-lucide-alert-circle" class="size-4 shrink-0" />
              {{ extensionsError }}
            </div>

            <!-- Default assistant -->
            <UFormField>
              <template #label><span class="inline-flex items-center gap-x-2">Default Assistant <UTooltip :delay-duration="0" text="Which assistant handles incoming calls"><UIcon name="i-lucide-info" class="size-3.5 text-(--ui-text-dimmed) cursor-help" /></UTooltip></span></template>
              <div v-if="assistantsLoading" class="flex items-center gap-2 py-1">
                <UIcon name="i-lucide-loader-2" class="size-4 text-(--ui-text-dimmed) animate-spin" />
                <span class="text-sm text-(--ui-text-dimmed)">Loading assistants...</span>
              </div>
              <USelect
                v-else-if="assistantOptions.length > 0"
                v-model="form.DEFAULT_ASSISTANT"
                :items="assistantOptions"
                placeholder="Select assistant"
              />
              <UInput
                v-else
                v-model="form.DEFAULT_ASSISTANT"
                placeholder="e.g. ivr-transfer"
                icon="i-lucide-bot"
              />
            </UFormField>
          </section>

          <div class="flex justify-between">
            <UButton label="Back" icon="i-lucide-arrow-left" color="neutral" variant="ghost" @click="step = 4" />
            <UButton
              label="Next"
              icon="i-lucide-arrow-right"
              trailing
              color="primary"
              @click="step = 6"
            />
          </div>
        </div>

        <!-- ═══ Step 6: Done ═══ -->
        <div v-else-if="step === 6" key="6" class="space-y-6">
          <section class="space-y-4">
            <div class="flex items-center gap-2 pb-2 border-b border-(--ui-border)">
              <UIcon name="i-lucide-check-circle" class="size-4 text-green-500" />
              <h4 class="text-sm font-bold uppercase tracking-wider text-(--ui-text-muted)">Configuration Summary</h4>
            </div>

            <!-- Summary checklist -->
            <div class="space-y-2">
              <div v-for="item in summaryItems" :key="item.label" class="flex items-center gap-3 p-2 rounded-lg">
                <UIcon
                  :name="item.done ? 'i-lucide-check-circle' : 'i-lucide-circle'"
                  :class="item.done ? 'text-green-500' : 'text-(--ui-text-dimmed)'"
                  class="size-5 shrink-0"
                />
                <div>
                  <p class="text-sm" :class="item.done ? 'text-(--ui-text-highlighted)' : 'text-(--ui-text-dimmed)'">
                    {{ item.label }}
                  </p>
                  <p v-if="item.detail" class="text-xs text-(--ui-text-muted)">{{ item.detail }}</p>
                </div>
              </div>
            </div>

            <!-- Pro tiers -->
            <div class="flex flex-col sm:flex-row gap-2">
              <component
                :is="isTierUnlocked(tier.id) ? 'div' : 'a'"
                v-for="tier in PRO_TIERS"
                :key="tier.id"
                v-bind="isTierUnlocked(tier.id) ? {} : { href: SPONSOR_URL, target: '_blank' }"
                class="flex-1 flex items-center gap-3 p-3 rounded-lg border transition-colors"
                :class="isTierUnlocked(tier.id)
                  ? 'border-green-500/30 bg-green-500/5'
                  : ['border-dashed', tier.borderClass, tier.bgClass]"
              >
                <UIcon :name="tier.icon" class="size-4 shrink-0" :class="`text-${tier.color}-500`" />
                <div class="flex-1 min-w-0">
                  <span class="text-sm font-semibold text-(--ui-text-highlighted)">{{ tier.label }}</span>
                  <p class="text-xs text-(--ui-text-muted) truncate">{{ tier.description }}</p>
                </div>
                <UBadge
                  :label="isTierUnlocked(tier.id) ? 'Unlocked' : tier.price"
                  :color="isTierUnlocked(tier.id) ? 'success' : (tier.color as any)"
                  variant="subtle"
                  size="md"
                />
              </component>
            </div>
          </section>

          <div v-if="saveError" class="flex items-center gap-2 text-sm text-(--ui-error)">
            <UIcon name="i-lucide-alert-circle" class="size-4 shrink-0" />
            {{ saveError }}
          </div>

          <div class="flex justify-between">
            <UButton label="Back" icon="i-lucide-arrow-left" color="neutral" variant="ghost" @click="step = 5" />
            <UButton
              label="Go to Dashboard"
              icon="i-lucide-arrow-right"
              trailing
              color="primary"
              size="lg"
              :loading="saving"
              @click="finishSetup"
            />
          </div>
        </div>
        </Transition>
      </UCard>

      <!-- Footer -->
      <footer v-if="step === 0 && !showAutoConfig" class="mt-8 text-center">
        <p class="text-(--ui-text-dimmed) text-xs">
          Check out <a :href="VORTIDECK_URL" target="_blank" class="text-(--ui-text-muted) hover:text-(--ui-primary) underline transition-colors">VortiDeck.com</a>
        </p>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: false });

const { markComplete } = useSetupStatus();
const { proActive, proTier, check: checkPro, activate } = useProStatus();

const licenseKey = ref("");
const licenseActivating = ref(false);
const licenseError = ref("");

async function activateLicense() {
  licenseActivating.value = true;
  licenseError.value = "";
  const err = await activate(licenseKey.value.trim());
  if (err) {
    licenseError.value = err;
  } else {
    licenseKey.value = "";
  }
  licenseActivating.value = false;
}

function isTierUnlocked(tierId: string): boolean {
  if (!proActive.value) return false;
  if (proTier.value === "installation") return true; // installation unlocks everything
  return proTier.value === tierId;
}

// --- Auto-Configure (Pro) ---
const showAutoConfig = ref(false);
const autoConfig = reactive({
  sshHost: "",
  sshPort: "22",
  sshUser: "root",
  sshPassword: "",
  listenerIp: "",
  stasisApp: "stasis-app",
  inboundDid: "",
  running: false,
  done: false,
  error: "",
  steps: [] as { id: string; label: string; status: string; detail?: string }[],
  detectedIps: [] as string[],
  formTouched: false,
});

const { emit: socketEmit, on: socketOn, off: socketOff } = useSocket();

let autoConfigTimeout: ReturnType<typeof setTimeout> | null = null;

function startAutoConfig() {
  autoConfig.formTouched = true;
  if (!autoConfig.sshHost || !autoConfig.sshUser || !autoConfig.sshPassword || !autoConfig.listenerIp) return;

  autoConfig.running = true;
  autoConfig.done = false;
  autoConfig.error = "";
  autoConfig.steps = [];

  socketEmit("setup:auto-configure", {
    sshHost: autoConfig.sshHost,
    sshPort: parseInt(autoConfig.sshPort) || 22,
    sshUser: autoConfig.sshUser,
    sshPassword: autoConfig.sshPassword,
    listenerIp: autoConfig.listenerIp,
    stasisApp: autoConfig.stasisApp,
    inboundDid: autoConfig.inboundDid.trim() || undefined,
    existingLogin: form.ASTERISK_LOGIN || undefined,
    existingPassword: form.ASTERISK_PASSWORD || undefined,
  });

  // 90s frontend timeout — SSH operations can take a while on slow connections
  autoConfigTimeout = setTimeout(() => {
    if (autoConfig.running) {
      autoConfig.running = false;
      autoConfig.done = true;
      autoConfig.error = "Timed out after 90 seconds — the PBX may be unreachable or slow to respond";
    }
  }, 90_000);
}

function cancelAutoConfig() {
  if (autoConfigTimeout) { clearTimeout(autoConfigTimeout); autoConfigTimeout = null; }
  autoConfig.running = false;
  autoConfig.done = false;
  autoConfig.error = "";
  autoConfig.steps = [];
}

function retryAutoConfig() {
  autoConfig.done = false;
  autoConfig.error = "";
  autoConfig.steps = [];
  startAutoConfig();
}

function onAutoConfigProgress(step: any) {
  if (!autoConfig.running) return; // Ignore late events after cancel
  autoConfig.steps.push(step);
}

function onAutoConfigDone(result: any) {
  if (autoConfigTimeout) { clearTimeout(autoConfigTimeout); autoConfigTimeout = null; }
  if (!autoConfig.running && autoConfig.done) return; // Ignore if already cancelled/timed out
  autoConfig.running = false;
  autoConfig.done = true;

  if (result.success && result.env) {
    // Fill the setup form with auto-configured values
    if (result.env.PBX_IP) form.PBX_IP = result.env.PBX_IP;
    if (result.env.ASTERISK_LOGIN) form.ASTERISK_LOGIN = result.env.ASTERISK_LOGIN;
    if (result.env.ASTERISK_PASSWORD) form.ASTERISK_PASSWORD = result.env.ASTERISK_PASSWORD;
    if (result.env.STASIS_APP_NAME) form.STASIS_APP_NAME = result.env.STASIS_APP_NAME;
    if (result.env.LISTENER_SERVER) form.LISTENER_SERVER = result.env.LISTENER_SERVER;

    // Mark ARI as tested since auto-config verified it
    ariResult.value = { success: true, version: "Auto-configured" };

    // Save env immediately
    $fetch("/api/env", {
      method: "PUT",
      body: { vars: result.env },
    }).catch(() => {});
  } else {
    autoConfig.error = result.error || "Auto-configure failed";
  }
}

// Auto-detect this server's IPs for the listener field
async function detectListenerIp() {
  try {
    const { ips } = await $fetch<{ ips: string[] }>("/api/detect-ip");
    autoConfig.detectedIps = ips;
    if (ips.length === 1 && !autoConfig.listenerIp) {
      autoConfig.listenerIp = ips[0]!;
    }
  } catch {}
}

// Detect IPs when auto-config panel opens
watch(showAutoConfig, (open) => {
  if (open && autoConfig.detectedIps.length === 0) detectListenerIp();
});

onMounted(() => {
  socketOn("setup:auto-configure:progress", onAutoConfigProgress);
  socketOn("setup:auto-configure:done", onAutoConfigDone);
});

onUnmounted(() => {
  socketOff("setup:auto-configure:progress", onAutoConfigProgress);
  socketOff("setup:auto-configure:done", onAutoConfigDone);
  if (autoConfigTimeout) { clearTimeout(autoConfigTimeout); autoConfigTimeout = null; }
});

const step = ref(0);
const showPassword = ref(false);

const stepLabels = ["Welcome", "Firewall", "PBX", "Dialplan", "Transcription", "Extensions", "Finish"];

const form = reactive({
  pbxType: "freepbx" as "freepbx" | "asterisk",
  PBX_IP: "",
  ASTERISK_LOGIN: "",
  ASTERISK_PASSWORD: "",
  STASIS_APP_NAME: "stasis-app",
  LISTENER_SERVER: "",
  EXTERNAL_HOST: "",
  transcriptionType: "parakeet" as "parakeet" | "google" | "whisper" | "skip",
  TRANSCRIPTION_SERVICES: "",
  GOOGLE_CREDENTIALS_JSON: "",
  DEFAULT_ASSISTANT: "",
});

const transcriptionOptions = [
  { value: "parakeet", label: "Parakeet" },
  { value: "google", label: "Google" },
  { value: "whisper", label: "Whisper" },
  { value: "skip", label: "Skip" },
];

// --- ARI Test ---
const ariTesting = ref(false);
const ariResult = ref<{ success: boolean; version?: string; error?: string; hint?: string; fail2ban?: boolean } | null>(null);

async function testAri() {
  ariTesting.value = true;
  ariResult.value = null;
  try {
    ariResult.value = await $fetch("/api/setup/test-ari", {
      method: "POST",
      body: {
        pbxIp: form.PBX_IP,
        login: form.ASTERISK_LOGIN,
        password: form.ASTERISK_PASSWORD,
      },
    });
  } catch (err: any) {
    ariResult.value = { success: false, error: err.data?.message || err.message || "Test failed" };
  } finally {
    ariTesting.value = false;
  }
}

// --- Google credentials (paste JSON in setup wizard) ---
const googleJsonSetup = ref("");

const googleSetupSummary = computed(() => {
  const raw = googleJsonSetup.value.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.project_id) return null;
    return { projectId: parsed.project_id, clientEmail: parsed.client_email || "" };
  } catch {
    return null;
  }
});

// Auto-encode to base64 when valid JSON is pasted
watch(googleJsonSetup, (raw) => {
  const trimmed = raw.trim();
  if (!trimmed) { form.GOOGLE_CREDENTIALS_JSON = ""; return; }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.type && parsed.project_id) {
      form.GOOGLE_CREDENTIALS_JSON = btoa(trimmed);
    }
  } catch {
    // Not valid JSON yet — user is still typing/pasting
  }
});

// Decode existing base64 on load
watch(() => form.GOOGLE_CREDENTIALS_JSON, (b64) => {
  if (b64 && !googleJsonSetup.value.trim()) {
    try { googleJsonSetup.value = atob(b64); } catch {}
  }
}, { immediate: true });

// --- Transcription Test ---
const transcriptionTesting = ref(false);
const transcriptionResult = ref<{ success: boolean; error?: string } | null>(null);

async function testTranscription() {
  transcriptionTesting.value = true;
  transcriptionResult.value = null;
  try {
    const body: any = { type: form.transcriptionType };
    if (form.transcriptionType === "google") {
      // Save credentials first so the server can materialize them for the test
      if (form.GOOGLE_CREDENTIALS_JSON) {
        await $fetch("/api/env", { method: "PUT", body: { vars: { GOOGLE_CREDENTIALS_JSON: form.GOOGLE_CREDENTIALS_JSON } } });
      }
      body.url = "";
    } else {
      body.url = form.TRANSCRIPTION_SERVICES;
    }
    transcriptionResult.value = await $fetch("/api/setup/test-transcription", {
      method: "POST",
      body,
    });
  } catch (err: any) {
    transcriptionResult.value = { success: false, error: err.data?.message || err.message || "Test failed" };
  } finally {
    transcriptionTesting.value = false;
  }
}

// --- Extensions ---
const extensions = ref<{ resource: string; state: string }[]>([]);
const extensionsLoading = ref(false);
const extensionsError = ref("");

async function fetchExtensions() {
  extensionsLoading.value = true;
  extensionsError.value = "";
  try {
    // Save PBX credentials first so the extensions endpoint can use them
    await $fetch("/api/env", {
      method: "PUT",
      body: {
        vars: {
          PBX_IP: form.PBX_IP,
          ASTERISK_LOGIN: form.ASTERISK_LOGIN,
          ASTERISK_PASSWORD: form.ASTERISK_PASSWORD,
          STASIS_APP_NAME: form.STASIS_APP_NAME,
        },
      },
    });
    const data = await $fetch<{ extensions: any[]; extensionsError: string }>("/api/extensions");
    if (data.extensionsError) {
      extensionsError.value = data.extensionsError;
    } else {
      extensions.value = data.extensions;
    }
  } catch (err: any) {
    extensionsError.value = err.data?.message || err.message || "Failed to fetch extensions";
  } finally {
    extensionsLoading.value = false;
  }
}

// --- Assistants ---
const assistantOptions = ref<{ label: string; value: string }[]>([]);
const assistantsLoading = ref(false);

async function loadAssistants() {
  assistantsLoading.value = true;
  try {
    const data = await $fetch<{ assistants: { slug: string; config: any }[] }>("/api/assistants", {
      signal: AbortSignal.timeout(5000),
    });
    assistantOptions.value = data.assistants.map((a) => ({
      label: a.config?.name || a.slug,
      value: a.slug,
    }));
  } catch {
    // Assistants load is optional — will show manual input fallback
  } finally {
    assistantsLoading.value = false;
  }
}

onMounted(async () => {
  // Pre-fill form with existing env values (for re-running the wizard)
  try {
    const { groups } = await $fetch<{ groups: { vars: { key: string; value: string }[] }[] }>("/api/env");
    const env: Record<string, string> = {};
    for (const g of groups) {
      for (const v of g.vars) {
        if (v.value) env[v.key] = v.value;
      }
    }
    if (env.PBX_IP) { form.PBX_IP = env.PBX_IP; autoConfig.sshHost = env.PBX_IP; }
    if (env.ASTERISK_LOGIN) form.ASTERISK_LOGIN = env.ASTERISK_LOGIN;
    if (env.ASTERISK_PASSWORD) form.ASTERISK_PASSWORD = env.ASTERISK_PASSWORD;
    if (env.STASIS_APP_NAME) { form.STASIS_APP_NAME = env.STASIS_APP_NAME; autoConfig.stasisApp = env.STASIS_APP_NAME; }
    if (env.LISTENER_SERVER) { form.LISTENER_SERVER = env.LISTENER_SERVER; autoConfig.listenerIp = env.LISTENER_SERVER; }
    if (env.EXTERNAL_HOST) form.EXTERNAL_HOST = env.EXTERNAL_HOST;
    if (env.SSH_HOST) autoConfig.sshHost = env.SSH_HOST;
    if (env.SSH_PORT) autoConfig.sshPort = env.SSH_PORT;
    if (env.SSH_USER) autoConfig.sshUser = env.SSH_USER;
    if (env.DEFAULT_ASSISTANT) form.DEFAULT_ASSISTANT = env.DEFAULT_ASSISTANT;
    if (env.GOOGLE_CREDENTIALS_JSON) form.GOOGLE_CREDENTIALS_JSON = env.GOOGLE_CREDENTIALS_JSON;
    if (env.TRANSCRIPTION_SERVICES) {
      const svc = env.TRANSCRIPTION_SERVICES;
      if (svc === "google") {
        form.transcriptionType = "google";
      } else if (svc.includes("whisper")) {
        form.transcriptionType = "whisper";
        form.TRANSCRIPTION_SERVICES = svc;
      } else {
        form.transcriptionType = "parakeet";
        form.TRANSCRIPTION_SERVICES = svc;
      }
    }
  } catch {
    // Fresh install — no env yet, fields stay empty
  }

  // Load assistants and Pro status in background
  loadAssistants();
  checkPro();
});

// --- Max reachable step ---
const maxReachableStep = computed(() => {
  if (!ariResult.value?.success) return 2;
  return 6;
});

// --- Summary ---
const summaryItems = computed(() => [
  {
    label: "PBX Connection",
    done: !!ariResult.value?.success,
    detail: form.PBX_IP ? `${form.PBX_IP} — ${ariResult.value?.version || ""}` : "",
  },
  {
    label: "Dialplan & Network",
    done: !!form.LISTENER_SERVER,
    detail: form.LISTENER_SERVER ? `Listener: ${form.LISTENER_SERVER}` : "Review dialplan setup",
  },
  {
    label: "Transcription Service",
    done: form.transcriptionType !== "skip" && (
      !!form.TRANSCRIPTION_SERVICES || !!form.GOOGLE_CREDENTIALS_JSON
    ),
    detail: form.transcriptionType === "skip"
      ? "Skipped"
      : form.transcriptionType === "google"
        ? "Google Cloud Speech"
        : `${form.transcriptionType} — ${form.TRANSCRIPTION_SERVICES}`,
  },
  {
    label: "Extensions",
    done: extensions.value.length > 0 || ariResult.value?.version === "Auto-configured",
    detail: extensions.value.length > 0
      ? `${extensions.value.length} extension${extensions.value.length !== 1 ? "s" : ""} found`
      : ariResult.value?.version === "Auto-configured"
        ? "Verified via auto-configure"
        : "Optional — fetch from step 5",
  },
  {
    label: "Default Assistant",
    done: !!form.DEFAULT_ASSISTANT,
    detail: form.DEFAULT_ASSISTANT || "Not set — will use ivr-transfer",
  },
]);

// --- Finish ---
const saving = ref(false);
const saveError = ref("");

async function finishSetup() {
  saving.value = true;
  saveError.value = "";
  try {
    // Build env vars to save
    const envVars: Record<string, string> = {
      PBX_IP: form.PBX_IP,
      ASTERISK_LOGIN: form.ASTERISK_LOGIN,
      ASTERISK_PASSWORD: form.ASTERISK_PASSWORD,
      STASIS_APP_NAME: form.STASIS_APP_NAME,
    };

    if (form.LISTENER_SERVER) envVars.LISTENER_SERVER = form.LISTENER_SERVER;
    if (form.EXTERNAL_HOST) envVars.EXTERNAL_HOST = form.EXTERNAL_HOST;
    if (form.DEFAULT_ASSISTANT) envVars.DEFAULT_ASSISTANT = form.DEFAULT_ASSISTANT;

    if (form.transcriptionType === "google") {
      envVars.TRANSCRIPTION_SERVICES = "google";
      if (form.GOOGLE_CREDENTIALS_JSON) {
        envVars.GOOGLE_CREDENTIALS_JSON = form.GOOGLE_CREDENTIALS_JSON;
      }
    } else if (form.transcriptionType !== "skip" && form.TRANSCRIPTION_SERVICES) {
      envVars.TRANSCRIPTION_SERVICES = form.TRANSCRIPTION_SERVICES;
    }

    await $fetch("/api/env", { method: "PUT", body: { vars: envVars } });

    markComplete();
    await navigateTo("/");
  } catch (err: any) {
    saveError.value = err.data?.message || err.message || "Failed to save configuration";
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.step-enter-active,
.step-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.step-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.step-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.setup-container {
  transition: max-width 0.3s ease;
}
</style>
