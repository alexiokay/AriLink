<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-(--ui-text-highlighted)">Campaigns</h1>
      <div class="flex items-center gap-2">
        <UButton
          v-if="!showWizard"
          label="New Campaign"
          icon="i-lucide-plus"
          color="primary"
          variant="soft"
          size="sm"
          @click="resetAndShowWizard"
        />
        <UBadge
          :label="campaignStatus.status"
          :color="statusColor"
          variant="subtle"
          icon="i-lucide-megaphone"
        />
      </div>
    </div>

    <!-- ═══ WIZARD: New Campaign ═══ -->
    <template v-if="showWizard && view === 'idle'">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-plus" class="size-4 text-(--ui-primary)" />
              <span class="font-semibold text-(--ui-text-highlighted)">New Campaign</span>
            </div>
            <!-- Step indicator -->
            <div class="flex items-center bg-(--ui-bg-elevated) rounded-lg p-0.5">
              <button
                v-for="(s, i) in stepLabels"
                :key="i"
                class="px-3 py-1 text-xs font-medium rounded-md transition-all"
                :class="step === i
                  ? 'bg-(--ui-bg) text-(--ui-text-highlighted) shadow-sm'
                  : i <= maxReachableStep
                    ? 'text-(--ui-text-muted) hover:text-(--ui-text)'
                    : 'text-(--ui-text-dimmed) cursor-not-allowed'"
                :disabled="i > maxReachableStep"
                @click="i <= maxReachableStep && (step = i)"
              >
                <span class="mr-1">{{ i + 1 }}.</span>{{ s }}
              </button>
            </div>
          </div>
        </template>

        <!-- Step 1: Details -->
        <div v-if="step === 0" class="space-y-6">
          <section class="space-y-4">
            <div class="flex items-center gap-2 pb-2 border-b border-(--ui-border)">
              <UIcon name="i-lucide-info" class="size-4 text-primary" />
              <h4 class="text-sm font-bold uppercase tracking-wider text-muted-foreground">Campaign Details</h4>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <UFormField label="Campaign Name" help="A descriptive name for this campaign">
                <UInput v-model="campaignName" placeholder="March Outreach" icon="i-lucide-tag" />
              </UFormField>
              <UFormField label="Assistant" help="Which assistant handles each outbound call in this campaign (independent from incoming call settings)">
                <USelect
                  v-if="assistantOptions.length > 0"
                  v-model="selectedAssistant"
                  :items="assistantOptions"
                  placeholder="Select assistant"
                />
                <p v-else class="text-sm text-(--ui-text-dimmed) italic py-2">
                  No assistants found. Create one on the Assistants page first.
                </p>
              </UFormField>
            </div>
          </section>

          <div class="flex justify-end gap-2">
            <UButton label="Cancel" color="neutral" variant="ghost" @click="showWizard = false" />
            <UButton
              label="Next"
              icon="i-lucide-arrow-right"
              trailing
              color="primary"
              :disabled="!campaignName.trim() || !selectedAssistant"
              @click="step = 1"
            />
          </div>
        </div>

        <!-- Step 2: Phone List -->
        <div v-if="step === 1" class="space-y-6">
          <section class="space-y-4">
            <div class="flex items-center justify-between pb-2 border-b border-(--ui-border)">
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-list" class="size-4 text-primary" />
                <h4 class="text-sm font-bold uppercase tracking-wider text-muted-foreground">Phone List</h4>
              </div>
              <!-- Source toggle -->
              <div class="flex items-center bg-(--ui-bg-elevated) rounded-lg p-0.5">
                <button
                  class="px-3 py-1 text-xs font-medium rounded-md transition-all"
                  :class="phoneSource === 'saved' ? 'bg-(--ui-bg) text-(--ui-text-highlighted) shadow-sm' : 'text-(--ui-text-muted) hover:text-(--ui-text)'"
                  @click="phoneSource = 'saved'"
                >
                  Saved List
                </button>
                <button
                  class="px-3 py-1 text-xs font-medium rounded-md transition-all"
                  :class="phoneSource === 'paste' ? 'bg-(--ui-bg) text-(--ui-text-highlighted) shadow-sm' : 'text-(--ui-text-muted) hover:text-(--ui-text)'"
                  @click="phoneSource = 'paste'"
                >
                  Paste Numbers
                </button>
              </div>
            </div>

            <!-- Saved list picker -->
            <div v-if="phoneSource === 'saved'">
              <UFormField label="Contact List" help="Select a saved contact list">
                <USelect
                  v-if="contactListOptions.length > 0"
                  v-model="selectedContactList"
                  :items="contactListOptions"
                  placeholder="Select a contact list"
                />
                <div v-else class="flex items-center gap-2 py-2">
                  <p class="text-sm text-(--ui-text-dimmed) italic">No saved lists.</p>
                  <NuxtLink to="/contacts" class="text-sm text-(--ui-primary) hover:underline">Create one</NuxtLink>
                </div>
              </UFormField>
              <div v-if="loadingContactList" class="flex items-center gap-2 mt-2 text-sm text-(--ui-text-muted)">
                <UIcon name="i-lucide-loader" class="size-4 animate-spin" />
                Loading entries...
              </div>
            </div>

            <!-- Paste mode -->
            <template v-if="phoneSource === 'paste'">
              <p class="text-sm text-(--ui-text-muted)">
                Paste as JSON array
                (<code class="font-mono text-xs bg-(--ui-bg-elevated) px-1 py-0.5 rounded">[{"phone":"123","name":"John"}]</code>)
                or one number per line
                (<code class="font-mono text-xs bg-(--ui-bg-elevated) px-1 py-0.5 rounded">phone,name</code>).
              </p>
              <textarea
                v-model="phoneListRaw"
                class="w-full min-h-48 font-mono text-sm p-4 rounded-lg bg-(--ui-bg-elevated) border border-(--ui-border) text-(--ui-text) resize-y focus:outline-none focus:ring-2 focus:ring-(--ui-primary)"
                placeholder='[{"phone": "123456789", "name": "John Doe"}]

or CSV:
123456789,John Doe
987654321,Jane Smith'
                spellcheck="false"
              />
              <div v-if="parseError" class="flex items-center gap-2 text-sm text-(--ui-error)">
                <UIcon name="i-lucide-alert-circle" class="size-4 shrink-0" />
                {{ parseError }}
              </div>
            </template>
          </section>

          <!-- Preview table -->
          <div v-if="parsedPhoneList.length > 0" class="border border-(--ui-border) rounded-lg overflow-hidden">
            <div class="flex items-center justify-between px-3 py-2 bg-(--ui-bg-elevated) border-b border-(--ui-border)">
              <span class="text-xs font-bold uppercase tracking-wider text-muted-foreground">Preview</span>
              <UBadge :label="`${parsedPhoneList.length} number${parsedPhoneList.length !== 1 ? 's' : ''}`" color="neutral" variant="subtle" size="sm" />
            </div>
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-(--ui-border)">
                  <th class="text-left py-2 px-3 text-(--ui-text-muted) font-medium w-12">#</th>
                  <th class="text-left py-2 px-3 text-(--ui-text-muted) font-medium">Phone</th>
                  <th class="text-left py-2 px-3 text-(--ui-text-muted) font-medium">Name</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(entry, i) in parsedPhoneList.slice(0, 10)"
                  :key="i"
                  class="border-b border-(--ui-border) last:border-0"
                >
                  <td class="py-1.5 px-3 text-(--ui-text-dimmed) tabular-nums">{{ i + 1 }}</td>
                  <td class="py-1.5 px-3 font-mono text-(--ui-text)">{{ entry.phone }}</td>
                  <td class="py-1.5 px-3 text-(--ui-text)">{{ entry.name || "-" }}</td>
                </tr>
              </tbody>
            </table>
            <div v-if="parsedPhoneList.length > 10" class="px-3 py-2 text-xs text-(--ui-text-dimmed) bg-(--ui-bg-elevated) border-t border-(--ui-border)">
              ... and {{ parsedPhoneList.length - 10 }} more
            </div>
          </div>

          <div class="flex justify-between">
            <UButton label="Back" icon="i-lucide-arrow-left" color="neutral" variant="ghost" @click="step = 0" />
            <UButton
              label="Next"
              icon="i-lucide-arrow-right"
              trailing
              color="primary"
              :disabled="parsedPhoneList.length === 0"
              @click="step = 2"
            />
          </div>
        </div>

        <!-- Step 3: Review & Launch -->
        <div v-if="step === 2" class="space-y-6">
          <!-- Summary -->
          <section class="space-y-4">
            <div class="flex items-center gap-2 pb-2 border-b border-(--ui-border)">
              <UIcon name="i-lucide-clipboard-check" class="size-4 text-primary" />
              <h4 class="text-sm font-bold uppercase tracking-wider text-muted-foreground">Review</h4>
            </div>
            <div class="grid grid-cols-3 gap-4">
              <div class="text-center p-4 bg-(--ui-bg-elevated) rounded-lg">
                <p class="text-2xl font-bold text-(--ui-text-highlighted) tabular-nums">{{ parsedPhoneList.length }}</p>
                <p class="text-sm text-(--ui-text-muted)">Numbers</p>
              </div>
              <div class="text-center p-4 bg-(--ui-bg-elevated) rounded-lg">
                <p class="text-lg font-bold text-(--ui-text-highlighted) truncate">{{ selectedAssistantLabel }}</p>
                <p class="text-sm text-(--ui-text-muted)">Assistant</p>
              </div>
              <div class="text-center p-4 bg-(--ui-bg-elevated) rounded-lg">
                <p class="text-2xl font-bold text-(--ui-text-highlighted) tabular-nums">{{ maxConcurrent }}</p>
                <p class="text-sm text-(--ui-text-muted)">Concurrent</p>
              </div>
            </div>
          </section>

          <!-- Settings override -->
          <section class="space-y-4">
            <div class="flex items-center gap-2 pb-2 border-b border-(--ui-border)">
              <UIcon name="i-lucide-sliders-horizontal" class="size-4 text-primary" />
              <h4 class="text-sm font-bold uppercase tracking-wider text-muted-foreground">Runtime Settings</h4>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <UFormField label="Max Concurrent Calls" help="Override the assistant default">
                <UInput v-model.number="maxConcurrent" type="number" min="1" max="20" icon="i-lucide-layers" />
              </UFormField>
              <UFormField label="Caller ID" help="Outbound caller ID number (leave empty for default)">
                <UInput v-model="callerId" placeholder="e.g. +48123456789" icon="i-lucide-phone-outgoing" />
              </UFormField>
            </div>
          </section>

          <div class="flex justify-between">
            <UButton label="Back" icon="i-lucide-arrow-left" color="neutral" variant="ghost" @click="step = 1" />
            <UButton
              label="Launch Campaign"
              icon="i-lucide-rocket"
              color="primary"
              size="lg"
              @click="startCampaign"
            />
          </div>
        </div>
      </UCard>
    </template>

    <!-- ═══ ACTIVE CAMPAIGN (running / paused) ═══ -->
    <UCard v-if="view === 'active'">
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-activity" class="size-4 text-(--ui-primary)" />
            <span class="font-semibold text-(--ui-text-highlighted)">
              {{ campaignStatus.name || "Campaign" }}
            </span>
            <UBadge
              v-if="campaignStatus.assistantSlug"
              :label="campaignStatus.assistantSlug"
              color="info"
              variant="subtle"
              size="sm"
              class="font-mono"
            />
          </div>
          <div class="flex items-center gap-2">
            <UBadge :label="`${campaignStatus.activeCalls} active`" color="info" variant="subtle" size="md" />
            <UBadge
              :label="`${campaignStatus.progress}/${campaignStatus.total}`"
              color="neutral"
              variant="subtle"
              size="md"
              class="tabular-nums"
            />
          </div>
        </div>
      </template>

      <div class="space-y-4">
        <!-- Progress bar -->
        <div>
          <div class="flex items-center justify-between mb-1">
            <span class="text-sm text-(--ui-text-muted)">Progress</span>
            <span class="text-sm text-(--ui-text) tabular-nums font-medium">{{ progressPercent }}%</span>
          </div>
          <div class="w-full h-3 bg-(--ui-bg-elevated) rounded-full overflow-hidden">
            <div
              class="h-full bg-(--ui-primary) rounded-full transition-all duration-300"
              :style="{ width: progressPercent + '%' }"
            />
          </div>
        </div>

        <!-- Control buttons -->
        <div class="flex gap-2">
          <UButton
            v-if="campaignStatus.status === 'running'"
            label="Pause"
            icon="i-lucide-pause"
            color="warning"
            variant="soft"
            size="md"
            @click="emit('dashboard:campaignPause')"
          />
          <UButton
            v-if="campaignStatus.status === 'paused'"
            label="Resume"
            icon="i-lucide-play"
            color="success"
            variant="soft"
            size="md"
            @click="emit('dashboard:campaignResume')"
          />
          <UButton
            label="Stop"
            icon="i-lucide-square"
            color="error"
            variant="soft"
            size="md"
            @click="emit('dashboard:campaignStop')"
          />
        </div>
      </div>
    </UCard>

    <!-- ═══ COMPLETED SUMMARY + ANALYTICS ═══ -->
    <UCard v-if="view === 'completed'">
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-check-circle" class="size-4 text-(--ui-success)" />
            <span class="font-semibold text-(--ui-text-highlighted)">
              {{ campaignStatus.name || "Campaign" }} Complete
            </span>
          </div>
          <div class="flex items-center gap-2">
            <UButton
              label="Export CSV"
              icon="i-lucide-download"
              color="neutral"
              variant="soft"
              size="sm"
              @click="exportCurrentCsv"
            />
            <UButton
              label="New Campaign"
              icon="i-lucide-plus"
              color="primary"
              variant="soft"
              size="md"
              @click="resetAndShowWizard"
            />
          </div>
        </div>
      </template>

      <div class="space-y-6">
        <!-- Stats row -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div v-for="(count, result) in resultSummary" :key="result" class="text-center">
            <p class="text-2xl font-bold text-(--ui-text-highlighted) tabular-nums">{{ count }}</p>
            <p class="text-sm text-(--ui-text-muted)">{{ result }}</p>
          </div>
        </div>

        <!-- Result distribution bar chart -->
        <div v-if="Object.keys(resultSummary).length > 0">
          <p class="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Result Distribution</p>
          <div class="space-y-2">
            <div v-for="(count, result) in resultSummary" :key="result" class="flex items-center gap-3">
              <span class="text-xs font-medium text-(--ui-text-muted) w-24 text-right truncate">{{ result }}</span>
              <div class="flex-1 h-6 bg-(--ui-bg-elevated) rounded-md overflow-hidden">
                <div
                  class="h-full rounded-md transition-all duration-500 flex items-center px-2"
                  :class="resultBarClass(String(result))"
                  :style="{ width: resultBarWidth(count as number) }"
                >
                  <span v-if="resultBarPercent(count as number) > 15" class="text-xs font-bold text-white">
                    {{ resultBarPercent(count as number) }}%
                  </span>
                </div>
              </div>
              <span class="text-xs font-mono text-(--ui-text-dimmed) w-12 tabular-nums">{{ count }}</span>
            </div>
          </div>
        </div>
      </div>
    </UCard>

    <!-- ═══ RESULTS TABLE ═══ -->
    <UCard v-if="campaignResults.length > 0">
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-table" class="size-4 text-(--ui-primary)" />
            <span class="font-semibold text-(--ui-text-highlighted)">Call Results</span>
          </div>
          <div class="flex items-center gap-2">
            <UButton
              label="CSV"
              icon="i-lucide-download"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="exportCurrentCsv"
            />
            <UBadge :label="`${campaignResults.length} calls`" color="neutral" variant="subtle" size="md" />
          </div>
        </div>
      </template>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-(--ui-border)">
              <th class="text-left py-2 px-3 text-(--ui-text-muted) font-medium">Phone</th>
              <th class="text-left py-2 px-3 text-(--ui-text-muted) font-medium">Name</th>
              <th class="text-left py-2 px-3 text-(--ui-text-muted) font-medium">Result</th>
              <th class="text-left py-2 px-3 text-(--ui-text-muted) font-medium">Duration</th>
              <th class="text-left py-2 px-3 text-(--ui-text-muted) font-medium">Time</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(r, i) in campaignResults"
              :key="i"
              class="border-b border-(--ui-border) last:border-0"
            >
              <td class="py-2 px-3 font-mono text-(--ui-text)">{{ r.phone }}</td>
              <td class="py-2 px-3 text-(--ui-text)">{{ r.name || "-" }}</td>
              <td class="py-2 px-3">
                <UBadge
                  :label="r.result"
                  :color="resultColor(r.result)"
                  variant="subtle"
                  size="md"
                />
              </td>
              <td class="py-2 px-3 text-(--ui-text-muted) tabular-nums">
                {{ r.duration ? formatDuration(r.duration) : "-" }}
              </td>
              <td class="py-2 px-3 text-(--ui-text-dimmed) whitespace-nowrap">
                {{ formatTime(r.timestamp) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>

    <!-- ═══ CAMPAIGN LOGS ═══ -->
    <UCard v-if="campaignLogs.length > 0">
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-terminal" class="size-4 text-(--ui-primary)" />
            <span class="font-semibold text-(--ui-text-highlighted)">Campaign Logs</span>
            <UBadge :label="`${campaignLogs.length}`" color="neutral" variant="subtle" size="sm" />
          </div>
          <UButton
            :label="showLogs ? 'Hide' : 'Show'"
            :icon="showLogs ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="showLogs = !showLogs"
          />
        </div>
      </template>

      <div v-if="showLogs" class="max-h-64 overflow-y-auto font-mono text-xs space-y-0.5">
        <div
          v-for="entry in campaignLogs.slice(0, 100)"
          :key="entry.id"
          class="flex gap-2 py-0.5 px-1 rounded hover:bg-(--ui-bg-elevated)"
        >
          <span class="text-(--ui-text-dimmed) shrink-0 tabular-nums">{{ formatLogTime(entry.timestamp) }}</span>
          <UBadge
            v-if="entry.level === 'error' || entry.level === 'warn'"
            :label="entry.level"
            :color="logLevelColor(entry.level)"
            variant="subtle"
            size="xs"
            class="shrink-0"
          />
          <span class="text-(--ui-text) break-all">{{ entry.message || entry.msg }}</span>
        </div>
      </div>
    </UCard>

    <!-- ═══ CAMPAIGN HISTORY ═══ -->
    <UCard v-if="campaignHistory.length > 0">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-history" class="size-4 text-(--ui-primary)" />
          <span class="font-semibold text-(--ui-text-highlighted)">Past Campaigns</span>
          <UBadge :label="`${campaignHistory.length}`" color="neutral" variant="subtle" size="sm" />
        </div>
      </template>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-(--ui-border)">
              <th class="text-left py-2 px-3 text-(--ui-text-muted) font-medium">Name</th>
              <th class="text-left py-2 px-3 text-(--ui-text-muted) font-medium">Assistant</th>
              <th class="text-left py-2 px-3 text-(--ui-text-muted) font-medium">Numbers</th>
              <th class="text-left py-2 px-3 text-(--ui-text-muted) font-medium">Results</th>
              <th class="text-left py-2 px-3 text-(--ui-text-muted) font-medium">Date</th>
              <th class="text-right py-2 px-3 text-(--ui-text-muted) font-medium w-32"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(c, i) in campaignHistory" :key="i">
              <tr class="border-b border-(--ui-border)">
                <td class="py-2 px-3 text-(--ui-text) font-medium">{{ c.name || "Unnamed" }}</td>
                <td class="py-2 px-3">
                  <UBadge :label="c.assistantSlug" color="info" variant="subtle" size="sm" class="font-mono" />
                </td>
                <td class="py-2 px-3 text-(--ui-text) tabular-nums">{{ c.totalProcessed }}/{{ c.totalNumbers }}</td>
                <td class="py-2 px-3">
                  <div class="flex gap-1 flex-wrap">
                    <UBadge
                      v-for="(count, result) in c.summary"
                      :key="result"
                      :label="`${result}: ${count}`"
                      :color="resultColor(String(result))"
                      variant="subtle"
                      size="md"
                    />
                  </div>
                </td>
                <td class="py-2 px-3 text-(--ui-text-dimmed) whitespace-nowrap">
                  {{ c.date ? formatTime(c.date) : "-" }}
                </td>
                <td class="py-2 px-3 text-right">
                  <div class="flex items-center justify-end gap-1">
                    <UButton
                      icon="i-lucide-download"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      title="Export CSV"
                      :loading="exportingFile === c.file"
                      @click="exportHistoryCsv(c)"
                    />
                    <UButton
                      icon="i-lucide-bar-chart-3"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      title="View analytics"
                      @click="toggleHistoryDetail(c.file)"
                    />
                    <UButton
                      label="Relaunch"
                      icon="i-lucide-refresh-cw"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      @click="relaunchCampaign(c)"
                    />
                  </div>
                </td>
              </tr>
              <!-- Expandable analytics row -->
              <tr v-if="expandedHistory === c.file" class="bg-(--ui-bg-elevated)/30">
                <td colspan="6" class="p-4">
                  <div v-if="historyDetailLoading" class="flex items-center gap-2 text-sm text-(--ui-text-muted)">
                    <UIcon name="i-lucide-loader" class="size-4 animate-spin" />
                    Loading campaign details...
                  </div>
                  <div v-else-if="historyDetail" class="space-y-4">
                    <!-- Distribution bars -->
                    <div class="space-y-2">
                      <p class="text-xs font-bold uppercase tracking-wider text-muted-foreground">Result Distribution</p>
                      <div v-for="(count, result) in c.summary" :key="result" class="flex items-center gap-3">
                        <span class="text-xs font-medium text-(--ui-text-muted) w-24 text-right truncate">{{ result }}</span>
                        <div class="flex-1 h-5 bg-(--ui-bg-elevated) rounded-md overflow-hidden">
                          <div
                            class="h-full rounded-md transition-all duration-500 flex items-center px-2"
                            :class="resultBarClass(String(result))"
                            :style="{ width: historyBarWidth(count as number, c.totalProcessed) }"
                          >
                            <span v-if="historyBarPercent(count as number, c.totalProcessed) > 15" class="text-[10px] font-bold text-white">
                              {{ historyBarPercent(count as number, c.totalProcessed) }}%
                            </span>
                          </div>
                        </div>
                        <span class="text-xs font-mono text-(--ui-text-dimmed) w-12 tabular-nums">{{ count }}</span>
                      </div>
                    </div>
                    <!-- Success rate -->
                    <div class="flex items-center gap-4 text-sm">
                      <span class="text-(--ui-text-muted)">Success rate:</span>
                      <span class="font-bold text-(--ui-text-highlighted)">
                        {{ historySuccessRate(c.summary, c.totalProcessed) }}%
                      </span>
                      <span class="text-(--ui-text-dimmed)">
                        ({{ (c.summary.answered || 0) + (c.summary.transferred || 0) }} of {{ c.totalProcessed }})
                      </span>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </UCard>

    <!-- ═══ EMPTY IDLE STATE ═══ -->
    <UCard v-if="view === 'idle' && !showWizard && campaignResults.length === 0 && campaignHistory.length === 0">
      <div class="py-12 text-center">
        <UIcon name="i-lucide-megaphone" class="size-12 text-(--ui-text-dimmed) mx-auto mb-3" />
        <p class="text-(--ui-text-muted)">No active campaign</p>
        <p class="text-sm text-(--ui-text-dimmed) mt-1">Create a new campaign to get started</p>
        <UButton
          label="New Campaign"
          icon="i-lucide-plus"
          color="primary"
          variant="soft"
          size="md"
          class="mt-4"
          @click="showWizard = true"
        />
      </div>
    </UCard>
  </div>
</template>

<script setup lang="ts">
const { campaignStatus, campaignResults, logs, emit } = useSocket();

// ── View state ──

const view = computed(() => {
  const s = campaignStatus.value.status;
  if (s === "running" || s === "paused") return "active";
  if (s === "completed" && campaignResults.value.length > 0) return "completed";
  return "idle";
});

const showWizard = ref(false);
const step = ref(0);
const stepLabels = ["Details", "Phone List", "Review"];

// ── Step 1: Details ──

const campaignName = ref("");
const selectedAssistant = ref("");
const allAssistants = ref<{ slug: string; config: any }[]>([]);

const assistantOptions = computed(() =>
  allAssistants.value.map((a) => ({
    label: a.config?.name || a.slug,
    value: a.slug,
  })),
);

const selectedAssistantLabel = computed(() => {
  const found = assistantOptions.value.find((a) => a.value === selectedAssistant.value);
  return found?.label || selectedAssistant.value;
});

async function fetchAssistants() {
  try {
    const data = await $fetch<{ assistants: any[] }>("/api/assistants");
    allAssistants.value = data.assistants || [];
  } catch (e) {
    console.error("Failed to fetch assistants:", e);
  }
}

// ── Step 2: Phone List ──

const phoneSource = ref<"saved" | "paste">("saved");
const phoneListRaw = ref("");
const parseError = ref("");

// Saved contact list
const selectedContactList = ref("");
const contactListEntries = ref<{ phone: string; name?: string }[]>([]);
const loadingContactList = ref(false);
const allContactLists = ref<{ id: string; name: string; count: number }[]>([]);

const contactListOptions = computed(() =>
  allContactLists.value.map((l) => ({
    label: `${l.name} (${l.count})`,
    value: l.id,
  })),
);

watch(selectedContactList, async (id) => {
  if (!id) { contactListEntries.value = []; return; }
  loadingContactList.value = true;
  try {
    const data = await $fetch<{ entries: { phone: string; name?: string }[] }>("/api/contact-lists", {
      query: { id },
    });
    contactListEntries.value = data.entries || [];
  } catch {
    contactListEntries.value = [];
  } finally {
    loadingContactList.value = false;
  }
});

async function fetchContactLists() {
  try {
    const data = await $fetch<{ lists: { id: string; name: string; count: number }[] }>("/api/contact-lists");
    allContactLists.value = data.lists || [];
  } catch { /* dir may not exist */ }
}

// Parsed from paste input
const pastedPhoneList = computed<{ phone: string; name?: string }[]>(() => {
  const raw = phoneListRaw.value.trim();
  if (!raw) { parseError.value = ""; return []; }

  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) { parseError.value = "JSON must be an array"; return []; }
      for (const entry of parsed) {
        if (!entry.phone || typeof entry.phone !== "string") {
          parseError.value = "Each entry must have a 'phone' string field";
          return [];
        }
      }
      parseError.value = "";
      return parsed;
    } catch {
      parseError.value = "Invalid JSON";
      return [];
    }
  }

  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const result: { phone: string; name?: string }[] = [];
  for (const line of lines) {
    const parts = line.split(",").map((p) => p.trim());
    if (!parts[0]) { parseError.value = `Empty phone in line: "${line}"`; return []; }
    result.push({ phone: parts[0], name: parts[1] || undefined });
  }
  parseError.value = "";
  return result;
});

// Unified: whichever source is active
const parsedPhoneList = computed(() =>
  phoneSource.value === "saved" ? contactListEntries.value : pastedPhoneList.value,
);

// ── Step 3: Settings ──

const maxConcurrent = ref(1);
const callerId = ref("");

watch(selectedAssistant, (slug) => {
  const a = allAssistants.value.find((x) => x.slug === slug);
  if (a?.config?.campaign?.maxConcurrent) {
    maxConcurrent.value = a.config.campaign.maxConcurrent;
  }
});

const maxReachableStep = computed(() => {
  if (!campaignName.value.trim() || !selectedAssistant.value) return 0;
  if (parsedPhoneList.value.length === 0) return 1;
  return 2;
});

// ── Actions ──

function startCampaign() {
  campaignResults.value = [];
  emit("dashboard:campaignStart", {
    phoneList: parsedPhoneList.value,
    name: campaignName.value,
    assistantSlug: selectedAssistant.value,
    maxConcurrent: maxConcurrent.value,
    callerId: callerId.value || undefined,
  });
  showWizard.value = false;
}

function resetAndShowWizard() {
  campaignResults.value = [];
  campaignName.value = "";
  phoneListRaw.value = "";
  selectedContactList.value = "";
  contactListEntries.value = [];
  phoneSource.value = "saved";
  callerId.value = "";
  step.value = 0;
  showWizard.value = true;
  fetchContactLists();
  emit("dashboard:getCampaignStatus");
}

// ── Display helpers ──

const statusColor = computed(() => {
  const s = campaignStatus.value.status;
  if (s === "running") return "success";
  if (s === "paused") return "warning";
  if (s === "completed") return "info";
  return "neutral";
});

const progressPercent = computed(() => {
  if (campaignStatus.value.total === 0) return 0;
  return Math.round((campaignStatus.value.progress / campaignStatus.value.total) * 100);
});

const resultSummary = computed(() => {
  const counts: Record<string, number> = {};
  for (const r of campaignResults.value) {
    counts[r.result] = (counts[r.result] || 0) + 1;
  }
  return counts;
});

type BadgeColor = "error" | "primary" | "secondary" | "success" | "info" | "warning" | "neutral";
function resultColor(result: string): BadgeColor {
  const colors: Record<string, BadgeColor> = {
    answered: "success",
    transferred: "info",
    no_interest: "warning",
    no_answer: "neutral",
    busy: "warning",
    failed: "error",
  };
  return colors[result] || "neutral";
}

// ── Analytics helpers ──

function resultBarWidth(count: number): string {
  const total = campaignResults.value.length;
  if (total === 0) return "0%";
  return Math.round((count / total) * 100) + "%";
}

function resultBarPercent(count: number): number {
  const total = campaignResults.value.length;
  if (total === 0) return 0;
  return Math.round((count / total) * 100);
}

function historyBarWidth(count: number, total: number): string {
  if (total === 0) return "0%";
  return Math.round((count / total) * 100) + "%";
}

function historyBarPercent(count: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((count / total) * 100);
}

function historySuccessRate(summary: Record<string, number>, total: number): number {
  if (total === 0) return 0;
  const success = (summary.answered || 0) + (summary.transferred || 0);
  return Math.round((success / total) * 100);
}

function resultBarClass(result: string): string {
  const classes: Record<string, string> = {
    answered: "bg-green-500",
    transferred: "bg-blue-500",
    no_interest: "bg-amber-500",
    no_answer: "bg-gray-400",
    busy: "bg-orange-500",
    failed: "bg-red-500",
  };
  return classes[result] || "bg-gray-400";
}

// ── CSV Export ──

function exportCurrentCsv() {
  if (campaignResults.value.length === 0) return;
  const rows = campaignResults.value.map((r: any) => ({
    phone: r.phone,
    name: r.name || "",
    result: r.result,
    duration: r.duration || "",
    timestamp: r.timestamp ? new Date(r.timestamp).toISOString() : "",
  }));
  downloadCsv(rows, `campaign-${campaignStatus.value.name || "results"}.csv`);
}

const exportingFile = ref("");

async function exportHistoryCsv(c: CampaignHistoryEntry) {
  exportingFile.value = c.file;
  try {
    const data = await $fetch<{ results?: any[] }>(`/api/campaigns/${c.file}`);
    if (data.results && data.results.length > 0) {
      const rows = data.results.map((r: any) => ({
        phone: r.phone,
        name: r.name || "",
        result: r.result,
        duration: r.duration || "",
        timestamp: r.timestamp ? new Date(r.timestamp).toISOString() : "",
      }));
      downloadCsv(rows, c.file.replace(".json", ".csv"));
    }
  } catch (e) {
    console.error("Failed to export campaign CSV:", e);
  } finally {
    exportingFile.value = "";
  }
}

function downloadCsv(rows: Record<string, any>[], filename: string) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]!);
  const csvLines = [headers.join(",")];
  for (const row of rows) {
    csvLines.push(headers.map((h) => {
      const val = String(row[h] ?? "");
      return val.includes(",") || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
    }).join(","));
  }
  const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── History detail expansion ──

const expandedHistory = ref("");
const historyDetail = ref<any>(null);
const historyDetailLoading = ref(false);

async function toggleHistoryDetail(file: string) {
  if (expandedHistory.value === file) {
    expandedHistory.value = "";
    historyDetail.value = null;
    return;
  }
  expandedHistory.value = file;
  historyDetailLoading.value = true;
  try {
    historyDetail.value = await $fetch(`/api/campaigns/${file}`);
  } catch {
    historyDetail.value = null;
  } finally {
    historyDetailLoading.value = false;
  }
}

// ── Campaign Logs ──

const campaignLogs = computed(() =>
  logs.value.filter((entry: any) => {
    const msg = entry.message || entry.msg || "";
    return msg.includes("[AutoDialer]") || msg.includes("[Dashboard] Starting campaign");
  }),
);

const showLogs = ref(false);

function formatLogTime(ts: string | number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString();
}

function logLevelColor(level: string): BadgeColor {
  if (level === "error") return "error";
  if (level === "warn") return "warning";
  return "neutral";
}

// ── Relaunch ──

function relaunchCampaign(c: CampaignHistoryEntry) {
  campaignResults.value = [];
  campaignName.value = c.name || "";
  selectedAssistant.value = c.assistantSlug || "";
  phoneListRaw.value = "";
  step.value = 0;
  showWizard.value = true;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatTime(ts: string): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString();
}

// ── Campaign History ──

interface CampaignHistoryEntry {
  file: string;
  name: string;
  assistantSlug: string;
  date: string;
  totalNumbers: number;
  totalProcessed: number;
  summary: Record<string, number>;
}

const campaignHistory = ref<CampaignHistoryEntry[]>([]);

async function fetchCampaignHistory() {
  try {
    const data = await $fetch<{ campaigns: CampaignHistoryEntry[] }>("/api/campaigns");
    campaignHistory.value = data.campaigns || [];
  } catch {
    // campaign-results dir may not exist yet
  }
}

// ── Init ──

onMounted(() => {
  fetchAssistants();
  fetchContactLists();
  fetchCampaignHistory();
  emit("dashboard:getCampaignStatus");
});
</script>
