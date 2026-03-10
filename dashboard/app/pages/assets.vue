<template>
  <div class="space-y-6 relative">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-(--ui-text-highlighted)">Asset Manager</h1>
        <p class="text-sm text-(--ui-text-muted)">Manage Sounds, Music on Hold, and Recordings</p>
      </div>
      <div class="flex gap-2">
        <UBadge
          v-if="isRemote"
          label="Remote (SFTP)"
          color="warning"
          variant="subtle"
          icon="i-lucide-cloud"
        />
        <UBadge
          v-else
          label="Local Filesystem"
          color="success"
          variant="subtle"
          icon="i-lucide-hard-drive"
        />
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
      <!-- Shortcuts Sidebar -->
      <UCard class="lg:col-span-1">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-bookmark" class="size-4 text-(--ui-primary)" />
            <span class="font-semibold">Quick Access</span>
          </div>
        </template>
        <div class="space-y-0.5">
          <button
            v-for="s in shortcuts"
            :key="s.path"
            class="w-full text-left flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all duration-150"
            :class="currentPath === s.path
              ? 'bg-(--ui-primary)/10 shadow-sm'
              : 'hover:bg-(--ui-bg-elevated)'"
            @click="navigateToPath(s.path)"
          >
            <UIcon
              :name="s.icon"
              class="size-4 shrink-0"
              :class="currentPath === s.path ? 'text-(--ui-primary)' : 'text-(--ui-text-dimmed)'"
            />
            <div class="flex-1 min-w-0">
              <p class="truncate font-medium" :class="currentPath === s.path ? 'text-(--ui-primary)' : 'text-(--ui-text)'">
                {{ s.name }}
              </p>
              <p v-if="s.desc" class="text-[11px] text-(--ui-text-dimmed) truncate leading-tight mt-0.5">
                {{ s.desc }}
              </p>
            </div>
          </button>
        </div>
      </UCard>

      <!-- File Explorer -->
      <UCard
        class="lg:col-span-3 min-h-[500px] flex flex-col relative"
        @dragover.prevent="onDragOver"
        @dragleave="onDragLeave"
        @drop.prevent="onDrop"
      >
        <!-- Drop overlay -->
        <div
          v-if="dragging"
          class="absolute inset-0 z-20 bg-(--ui-primary)/10 border-2 border-dashed border-(--ui-primary) rounded-xl flex items-center justify-center pointer-events-none"
        >
          <div class="text-center">
            <UIcon name="i-lucide-upload" class="size-12 text-(--ui-primary) mx-auto mb-2" />
            <p class="text-lg font-semibold text-(--ui-primary)">Drop files here to upload</p>
            <p v-if="autoConvert" class="text-sm text-(--ui-text-muted) mt-1">Auto-convert is on</p>
          </div>
        </div>

        <template #header>
          <div class="space-y-2">
            <!-- Toolbar row -->
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2 overflow-hidden">
                <UButton
                  icon="i-lucide-chevron-left"
                  variant="soft"
                  size="xs"
                  :disabled="!canGoUp"
                  @click="goUp"
                />
                <!-- Breadcrumbs -->
                <div class="flex items-center gap-0.5 text-sm font-mono overflow-hidden">
                  <button
                    v-for="(crumb, i) in breadcrumbs"
                    :key="i"
                    class="flex items-center gap-0.5 shrink-0"
                    @click="navigateToPath(crumb.path)"
                  >
                    <UIcon v-if="i > 0" name="i-lucide-chevron-right" class="size-3 text-(--ui-text-dimmed) shrink-0" />
                    <span
                      class="px-1 py-0.5 rounded transition-colors truncate max-w-32"
                      :class="i === breadcrumbs.length - 1
                        ? 'text-(--ui-text-highlighted) font-semibold'
                        : 'text-(--ui-text-dimmed) hover:text-(--ui-primary) hover:bg-(--ui-primary)/5 cursor-pointer'"
                    >{{ crumb.label }}</span>
                  </button>
                </div>
                <span v-if="items.length > 0" class="text-xs text-(--ui-text-dimmed) tabular-nums shrink-0">{{ items.length }}</span>
              </div>
              <div class="flex items-center gap-3">
                <UInput
                  v-model="searchInput"
                  icon="i-lucide-search"
                  placeholder="Filter files..."
                  size="sm"
                  variant="subtle"
                  class="w-44"
                  :ui="{ leadingIcon: 'text-(--ui-text-dimmed)' }"
                />
                <label class="flex items-center gap-2 cursor-pointer text-sm text-(--ui-text-muted)">
                  <USwitch v-model="autoConvert" size="sm" />
                  Auto-convert
                </label>
                <UButton
                  icon="i-lucide-folder-plus"
                  color="neutral"
                  variant="soft"
                  size="sm"
                  @click="showMkdirModal = true"
                />
                <UButton
                  label="Upload"
                  icon="i-lucide-upload"
                  color="primary"
                  variant="soft"
                  size="sm"
                  :loading="uploading"
                  @click="triggerUpload"
                />
                <input
                  ref="fileInput"
                  type="file"
                  multiple
                  class="hidden"
                  @change="handleUpload"
                />
              </div>
            </div>
          </div>
        </template>

        <!-- Loading / Error -->
        <div v-if="loading" class="flex-1 flex flex-col items-center justify-center py-12">
          <UIcon name="i-lucide-loader-2" class="size-8 animate-spin text-(--ui-primary) mb-4" />
          <p class="text-sm text-(--ui-text-muted)">Fetching assets...</p>
        </div>
        <div v-else-if="error" class="flex-1 flex flex-col items-center justify-center py-12">
          <UIcon name="i-lucide-alert-triangle" class="size-8 text-(--ui-error) mb-4" />
          <p class="text-sm text-(--ui-error)">{{ error }}</p>
          <UButton label="Retry" variant="soft" color="neutral" class="mt-4" @click="fetchAssets" />
        </div>

        <!-- File List -->
        <div v-else class="flex-1 overflow-x-auto">
          <!-- Player error banner -->
          <div v-if="playerError" class="mx-4 mt-2 mb-1 px-3 py-2 rounded-lg text-sm flex items-center gap-2 bg-(--ui-error)/10 text-(--ui-error)">
            <UIcon name="i-lucide-alert-triangle" class="size-4 shrink-0" />
            <span class="truncate">{{ playerError }}</span>
            <UButton icon="i-lucide-x" variant="ghost" size="xs" class="ml-auto" @click="playerError = ''" />
          </div>

          <!-- Conversion feedback banner -->
          <div v-if="conversionResult" class="mx-4 mt-2 mb-1 px-3 py-2 rounded-lg text-sm flex items-center gap-2" :class="conversionResult.success ? 'bg-(--ui-success)/10 text-(--ui-success)' : 'bg-(--ui-warning)/10 text-(--ui-warning)'">
            <UIcon :name="conversionResult.success ? 'i-lucide-check-circle' : 'i-lucide-alert-triangle'" class="size-4 shrink-0" />
            <span>{{ conversionResult.message }}</span>
            <UButton icon="i-lucide-x" variant="ghost" size="xs" class="ml-auto" @click="conversionResult = null" />
          </div>

          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-(--ui-border) text-xs uppercase text-(--ui-text-dimmed)">
                <th class="px-4 py-3 font-semibold">Name</th>
                <th class="px-4 py-3 font-semibold">Size</th>
                <th class="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in visibleItems"
                :key="item.name"
                class="border-b border-(--ui-border-muted) hover:bg-(--ui-bg-elevated) transition-colors group"
                :class="{ 'bg-(--ui-primary)/5': playerState.playing && playerState.name === item.name }"
                @dblclick="item.type === 'directory' ? navigateToPath(currentPath + '/' + item.name) : null"
                @contextmenu.prevent="openContextMenu($event, item)"
              >
                <td class="px-4 py-2 flex items-center gap-3">
                  <UIcon
                    :name="fileIcon(item)"
                    class="size-5"
                    :class="item.type === 'directory' ? 'text-amber-400' : isAudio(item.name) ? 'text-blue-400' : 'text-(--ui-text-dimmed)'"
                  />
                  <span
                    class="truncate font-medium cursor-pointer hover:text-(--ui-primary)"
                    @click="item.type === 'directory' ? navigateToPath(currentPath + '/' + item.name) : null"
                  >
                    {{ item.name }}
                  </span>
                </td>
                <td class="px-4 py-2 text-sm text-(--ui-text-muted)">
                  {{ item.type === 'directory' ? '—' : formatSize(item.size) }}
                </td>
                <td class="px-4 py-2 text-right">
                  <div class="flex justify-end gap-1">
                    <UButton
                      v-if="isAudio(item.name)"
                      :icon="playerState.playing && playerState.name === item.name ? 'i-lucide-pause' : 'i-lucide-play'"
                      variant="ghost"
                      color="primary"
                      size="xs"
                      @click="togglePlay(item)"
                    />
                    <UButton
                      v-if="isConvertible(item.name)"
                      icon="i-lucide-audio-waveform"
                      variant="ghost"
                      color="warning"
                      size="xs"
                      :loading="converting === item.name"
                      @click="convertFile(item)"
                    />
                    <UButton
                      icon="i-lucide-trash-2"
                      variant="ghost"
                      color="error"
                      size="xs"
                      @click="confirmDelete(item)"
                    />
                  </div>
                </td>
              </tr>
              <tr v-if="filteredItems.length === 0">
                <td colspan="3" class="px-4 py-8 text-center text-(--ui-text-dimmed) italic">
                  {{ items.length === 0 ? 'Empty directory' : 'No files match filter' }}
                </td>
              </tr>
              <tr v-if="filteredItems.length > displayLimit">
                <td colspan="3" class="px-1 py-1">
                  <div ref="scrollSentinel" class="h-1" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Audio Player Bar (fixed bottom of viewport) -->
        <Teleport to="body">
        <div
          v-if="playerState.playing || playerState.paused"
          class="fixed bottom-0 left-0 right-0 bg-(--ui-bg-elevated) border-t border-(--ui-border) px-6 py-3 flex items-center gap-3 z-50 shadow-lg"
        >
          <UButton
            :icon="playerState.playing ? 'i-lucide-pause' : 'i-lucide-play'"
            variant="soft"
            color="primary"
            size="xs"
            @click="playerToggle"
          />
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-(--ui-text-highlighted) truncate">{{ playerState.name }}</p>
            <div class="flex items-center gap-2 mt-1">
              <span class="text-[11px] text-(--ui-text-dimmed) tabular-nums w-10">{{ formatTime(playerState.currentTime) }}</span>
              <div
                class="flex-1 h-1.5 bg-(--ui-bg) rounded-full cursor-pointer relative group"
                @click="seekAudio($event)"
                ref="seekBarRef"
              >
                <div
                  class="h-full bg-(--ui-primary) rounded-full transition-[width] duration-100"
                  :style="{ width: playerProgress + '%' }"
                />
                <div
                  class="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-(--ui-primary) rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  :style="{ left: playerProgress + '%', marginLeft: '-6px' }"
                />
              </div>
              <span class="text-[11px] text-(--ui-text-dimmed) tabular-nums w-10 text-right">{{ formatTime(playerState.duration) }}</span>
            </div>
          </div>
          <UButton
            icon="i-lucide-x"
            variant="ghost"
            color="neutral"
            size="xs"
            @click="stopPlayer"
          />
        </div>
        </Teleport>
      </UCard>
    </div>

    <!-- Context Menu -->
    <Teleport to="body">
      <div
        v-if="ctxMenu.show"
        class="fixed inset-0 z-50"
        @click="closeContextMenu"
        @contextmenu.prevent="closeContextMenu"
      >
        <div
          class="absolute bg-(--ui-bg-elevated) border border-(--ui-border) rounded-lg shadow-lg py-1 min-w-48 z-50"
          :style="{ top: ctxMenu.y + 'px', left: ctxMenu.x + 'px' }"
        >
          <!-- Directory items -->
          <template v-if="ctxMenu.item?.type === 'directory'">
            <button class="ctx-item" @click="ctxOpen">
              <UIcon name="i-lucide-folder-open" class="size-4" />
              Open
            </button>
          </template>

          <!-- Audio items -->
          <template v-if="ctxMenu.item && isAudio(ctxMenu.item.name)">
            <button class="ctx-item" @click="ctxPlay">
              <UIcon name="i-lucide-play" class="size-4" />
              {{ playerState.playing && playerState.name === ctxMenu.item.name ? 'Pause' : 'Play' }}
            </button>
          </template>

          <!-- Convertible items -->
          <template v-if="ctxMenu.item && isConvertible(ctxMenu.item.name)">
            <button class="ctx-item" @click="ctxConvert">
              <UIcon name="i-lucide-audio-waveform" class="size-4" />
              Convert to Asterisk formats
            </button>
          </template>

          <div v-if="ctxMenu.item?.type !== 'directory' || isAudio(ctxMenu.item?.name || '')" class="border-t border-(--ui-border) my-1" />

          <!-- Common items -->
          <button class="ctx-item" @click="ctxRename">
            <UIcon name="i-lucide-pencil" class="size-4" />
            Rename
          </button>
          <button class="ctx-item text-(--ui-error)" @click="ctxDelete">
            <UIcon name="i-lucide-trash-2" class="size-4" />
            Delete
          </button>
        </div>
      </div>
    </Teleport>

    <!-- Modals -->
    <UModal v-model:open="showMkdirModal" title="New Directory">
      <template #body>
        <UFormField label="Folder Name">
          <UInput v-model="newDirName" placeholder="Enter folder name" @keyup.enter="createDir" />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton label="Cancel" variant="ghost" color="neutral" @click="showMkdirModal = false" />
          <UButton label="Create" color="primary" :loading="working" @click="createDir" />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="showRenameModal" title="Rename">
      <template #body>
        <UFormField label="New Name">
          <UInput v-model="renameName" placeholder="Enter new name" @keyup.enter="doRename" />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton label="Cancel" variant="ghost" color="neutral" @click="showRenameModal = false" />
          <UButton label="Rename" color="primary" :loading="working" @click="doRename" />
        </div>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
const currentPath = ref("");
const items = ref<any[]>([]);
const shortcuts = ref<any[]>([]);
const isRemote = ref(false);
const loading = ref(false);
const error = ref("");
const working = ref(false);
const uploading = ref(false);
const converting = ref<string | null>(null);
const autoConvert = ref(true);
const conversionResult = ref<{ success: boolean; message: string } | null>(null);
const playerError = ref("");

const showMkdirModal = ref(false);
const newDirName = ref("");
const showRenameModal = ref(false);
const renameName = ref("");
const renameItem = ref<any>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const seekBarRef = ref<HTMLElement | null>(null);
const dragging = ref(false);
const searchInput = ref("");
const searchFilter = ref("");
const displayLimit = ref(200);
const scrollSentinel = ref<HTMLElement | null>(null);
let dragCounter = 0;
let searchTimeout: ReturnType<typeof setTimeout> | null = null;
let scrollObserver: IntersectionObserver | null = null;

watch(searchInput, (val) => {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    searchFilter.value = val;
    displayLimit.value = 200;
  }, 250);
});

watch(scrollSentinel, (el) => {
  if (scrollObserver) scrollObserver.disconnect();
  if (!el) return;
  scrollObserver = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting) {
      displayLimit.value += 200;
    }
  }, { rootMargin: "200px" });
  scrollObserver.observe(el);
});

// ── Drag & Drop ──

function onDragOver(e: DragEvent) {
  dragCounter++;
  dragging.value = true;
}

function onDragLeave(e: DragEvent) {
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    dragging.value = false;
  }
}

async function onDrop(e: DragEvent) {
  dragCounter = 0;
  dragging.value = false;
  const files = e.dataTransfer?.files;
  if (!files?.length) return;
  await uploadFiles(Array.from(files));
}

// ── Context Menu ──

const ctxMenu = reactive({
  show: false,
  x: 0,
  y: 0,
  item: null as any,
});

function openContextMenu(e: MouseEvent, item: any) {
  // Position, clamping to viewport
  const x = Math.min(e.clientX, window.innerWidth - 220);
  const y = Math.min(e.clientY, window.innerHeight - 200);
  ctxMenu.x = x;
  ctxMenu.y = y;
  ctxMenu.item = item;
  ctxMenu.show = true;
}

function closeContextMenu() {
  ctxMenu.show = false;
}

function ctxOpen() {
  if (ctxMenu.item?.type === "directory") {
    navigateToPath(currentPath.value + "/" + ctxMenu.item.name);
  }
  closeContextMenu();
}

function ctxPlay() {
  if (ctxMenu.item) togglePlay(ctxMenu.item);
  closeContextMenu();
}

function ctxConvert() {
  if (ctxMenu.item) convertFile(ctxMenu.item);
  closeContextMenu();
}

function ctxRename() {
  renameItem.value = ctxMenu.item;
  renameName.value = ctxMenu.item?.name || "";
  showRenameModal.value = true;
  closeContextMenu();
}

function ctxDelete() {
  if (ctxMenu.item) confirmDelete(ctxMenu.item);
  closeContextMenu();
}

async function doRename() {
  if (!renameItem.value || !renameName.value || renameName.value === renameItem.value.name) {
    showRenameModal.value = false;
    return;
  }
  working.value = true;
  try {
    await $fetch("/api/assets/manage", {
      method: "POST",
      body: {
        action: "rename",
        path: currentPath.value + "/" + renameItem.value.name,
        newPath: currentPath.value + "/" + renameName.value,
      }
    });
    showRenameModal.value = false;
    fetchAssets();
  } catch (e: any) {
    alert("Rename failed: " + (e.data?.message || e.message));
  } finally {
    working.value = false;
  }
}

// ── Breadcrumbs ──

const breadcrumbs = computed(() => {
  if (!currentPath.value) return [{ label: "/", path: "/" }];
  const parts = currentPath.value.split("/").filter(Boolean);
  const crumbs = [{ label: "/", path: "/" }];
  let acc = "";
  for (const part of parts) {
    acc += "/" + part;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
});

const canGoUp = computed(() => {
  return currentPath.value !== "/" && currentPath.value !== "";
});

// ── Audio Player ──

const playerState = reactive({
  playing: false,
  paused: false,
  name: "",
  currentTime: 0,
  duration: 0,
});

let audioEl: HTMLAudioElement | null = null;
let animFrame = 0;
let playGen = 0; // generation counter to prevent race conditions

function updatePlayerTime() {
  if (audioEl) {
    playerState.currentTime = audioEl.currentTime;
    playerState.duration = audioEl.duration || 0;
  }
  if (playerState.playing) {
    animFrame = requestAnimationFrame(updatePlayerTime);
  }
}

const playerProgress = computed(() => {
  if (!playerState.duration) return 0;
  return (playerState.currentTime / playerState.duration) * 100;
});

function togglePlay(item: any) {
  if (!isAudio(item.name)) return;

  // If same file is playing, toggle pause
  if (audioEl && playerState.name === item.name) {
    if (playerState.playing) {
      audioEl.pause();
      playerState.playing = false;
      playerState.paused = true;
      cancelAnimationFrame(animFrame);
    } else {
      audioEl.play().catch(() => {});
      playerState.playing = true;
      playerState.paused = false;
      updatePlayerTime();
    }
    return;
  }

  // New file — stop old first
  stopPlayer();
  playerError.value = "";
  const gen = ++playGen;
  const url = `/api/assets/play?path=${encodeURIComponent(currentPath.value + '/' + item.name)}`;
  const audio = new Audio(url);
  audioEl = audio;
  playerState.name = item.name;
  playerState.currentTime = 0;
  playerState.duration = 0;
  playerState.playing = true;
  playerState.paused = false;

  audio.addEventListener("ended", () => {
    if (gen !== playGen) return;
    playerState.playing = false;
    playerState.paused = true;
    playerState.currentTime = 0;
    cancelAnimationFrame(animFrame);
  });

  audio.addEventListener("loadedmetadata", () => {
    if (gen !== playGen) return;
    playerState.duration = audio.duration || 0;
  });

  audio.addEventListener("error", () => {
    if (gen !== playGen) return;
    const code = audio.error?.code;
    const msg = audio.error?.message || "Unknown error";
    playerError.value = `Playback failed (code ${code}): ${msg}`;
    stopPlayer();
  });

  audio.play().catch((err) => {
    if (gen === playGen) {
      playerError.value = `Play failed: ${err.message}`;
      stopPlayer();
    }
  });

  updatePlayerTime();
}

function playerToggle() {
  if (!audioEl) return;
  if (playerState.playing) {
    audioEl.pause();
    playerState.playing = false;
    playerState.paused = true;
    cancelAnimationFrame(animFrame);
  } else {
    audioEl.play().catch(() => {});
    playerState.playing = true;
    playerState.paused = false;
    updatePlayerTime();
  }
}

function stopPlayer() {
  playGen++;
  if (audioEl) {
    audioEl.pause();
    audioEl.removeAttribute("src");
    audioEl.load(); // abort any pending network request
    audioEl = null;
  }
  playerState.playing = false;
  playerState.paused = false;
  playerState.name = "";
  playerState.currentTime = 0;
  playerState.duration = 0;
  cancelAnimationFrame(animFrame);
}

function seekAudio(e: MouseEvent) {
  if (!audioEl || !seekBarRef.value) return;
  const rect = seekBarRef.value.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  audioEl.currentTime = ratio * (audioEl.duration || 0);
  playerState.currentTime = audioEl.currentTime;
}

function formatTime(sec: number) {
  if (!sec || !isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ── File helpers ──

function fileIcon(item: any) {
  if (item.type === "directory") return "i-lucide-folder";
  if (isAudio(item.name)) return "i-lucide-file-audio";
  const ext = item.name.split(".").pop()?.toLowerCase();
  if (ext === "json" || ext === "ts" || ext === "js" || ext === "sh") return "i-lucide-file-code";
  return "i-lucide-file";
}

async function fetchAssets() {
  loading.value = true;
  error.value = "";
  try {
    const data = await $fetch<{ items: any[], shortcuts: any[], path: string, isRemote: boolean }>("/api/assets/list", {
      query: { path: currentPath.value || undefined }
    });
    items.value = data.items;
    shortcuts.value = data.shortcuts;
    currentPath.value = data.path;
    isRemote.value = data.isRemote;
  } catch (e: any) {
    error.value = e.data?.message || "Failed to fetch assets";
  } finally {
    loading.value = false;
  }
}

const sortedItems = computed(() => {
  return [...items.value].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
});

const filteredItems = computed(() => {
  const q = searchFilter.value.toLowerCase().trim();
  if (!q) return sortedItems.value;
  return sortedItems.value.filter((item) => item.name.toLowerCase().includes(q));
});

const visibleItems = computed(() => {
  return filteredItems.value.slice(0, displayLimit.value);
});

const AUDIO_EXT = ["wav", "mp3", "gsm", "sln", "sln16", "ulaw", "alaw", "g722", "ogg", "flac", "aiff"];
const CONVERTIBLE_EXT = ["wav", "mp3", "ogg", "flac", "aiff", "gsm"];

function isAudio(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  return AUDIO_EXT.includes(ext || "");
}

function isConvertible(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  return CONVERTIBLE_EXT.includes(ext || "");
}

function formatSize(bytes: number) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function navigateToPath(path: string) {
  currentPath.value = path.replace(/\/+/g, "/");
  searchInput.value = "";
  searchFilter.value = "";
  displayLimit.value = 200;
  fetchAssets();
}

function goUp() {
  const parts = currentPath.value.split("/");
  parts.pop();
  navigateToPath(parts.join("/") || "/");
}

function triggerUpload() {
  fileInput.value?.click();
}

function showConversionFeedback(data: any) {
  if (!data) return;
  if (data.error) {
    conversionResult.value = { success: false, message: `Conversion failed: ${data.error}` };
  } else if (data.converted?.length > 0) {
    const msg = `Converted to: ${data.converted.join(", ")}`;
    const failMsg = data.failed?.length ? ` | Failed: ${data.failed.map((f: any) => f.format).join(", ")}` : "";
    conversionResult.value = { success: !data.failed?.length, message: msg + failMsg };
  }
}

async function handleUpload(e: Event) {
  const target = e.target as HTMLInputElement;
  const files = target.files;
  if (!files?.length) return;
  await uploadFiles(Array.from(files));
  if (fileInput.value) fileInput.value.value = "";
}

async function uploadFiles(files: File[]) {
  uploading.value = true;
  conversionResult.value = null;

  for (const file of files) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("path", currentPath.value);
    if (autoConvert.value) {
      formData.append("convert", "true");
    }

    try {
      const res = await $fetch<{ success: boolean; path: string; conversion: any }>("/api/assets/upload", {
        method: "POST",
        body: formData
      });
      if (res.conversion) {
        showConversionFeedback(res.conversion);
      }
    } catch (e: any) {
      alert(`Upload failed (${file.name}): ` + (e.data?.message || e.message));
    }
  }

  uploading.value = false;
  fetchAssets();
}

async function convertFile(item: any) {
  converting.value = item.name;
  conversionResult.value = null;
  try {
    const res = await $fetch<{ success: boolean; converted: string[]; failed: any[]; files: string[] }>("/api/assets/convert", {
      method: "POST",
      body: { path: currentPath.value + "/" + item.name }
    });
    showConversionFeedback(res);
    fetchAssets();
  } catch (e: any) {
    conversionResult.value = { success: false, message: e.data?.message || e.message || "Conversion failed" };
  } finally {
    converting.value = null;
  }
}

async function createDir() {
  if (!newDirName.value) return;
  working.value = true;
  try {
    await $fetch("/api/assets/manage", {
      method: "POST",
      body: {
        action: "mkdir",
        path: currentPath.value + "/" + newDirName.value
      }
    });
    showMkdirModal.value = false;
    newDirName.value = "";
    fetchAssets();
  } catch (e: any) {
    alert("Failed to create folder: " + (e.data?.message || e.message));
  } finally {
    working.value = false;
  }
}

async function confirmDelete(item: any) {
  if (!confirm(`Delete ${item.name}?`)) return;
  try {
    await $fetch("/api/assets/manage", {
      method: "POST",
      body: {
        action: "delete",
        path: currentPath.value + "/" + item.name
      }
    });
    fetchAssets();
  } catch (e: any) {
    alert("Delete failed: " + (e.data?.message || e.message));
  }
}

onMounted(() => {
  fetchAssets();
});

onUnmounted(() => {
  stopPlayer();
  if (scrollObserver) scrollObserver.disconnect();
});
</script>

<style scoped>
.ctx-item {
  width: 100%;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  transition: background-color 0.15s;
  cursor: pointer;
}
.ctx-item:hover {
  background-color: var(--ui-bg-elevated);
}
</style>
