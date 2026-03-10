<template>
  <div class="cyber-layout">
    <!-- Sidebar -->
    <aside class="cyber-sidebar" :class="{ 'cyber-sidebar--collapsed': collapsed }">
      <!-- Header: toggle is first so it stays visible when clipped -->
      <div class="cyber-sidebar-header">
        <button class="cyber-sidebar-toggle" @click="collapsed = !collapsed">
          <UIcon :name="collapsed ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'" class="size-4" />
        </button>
        <NuxtLink to="/" class="cyber-sidebar-home">
          <div class="cyber-sidebar-logo">
            <UIcon name="i-lucide-radio" class="size-5" />
          </div>
          <span class="cyber-sidebar-brand">
            <span class="cyber-brand-ari">ARI</span><span class="cyber-brand-link">LINK</span>
          </span>
        </NuxtLink>
      </div>

      <!-- Navigation -->
      <nav class="cyber-sidebar-nav">
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="cyber-nav-item"
          :class="{ 'cyber-nav-item--active': isActive(item.to) }"
          :title="item.label"
        >
          <div class="cyber-nav-icon">
            <UIcon :name="item.icon" class="size-4" />
          </div>
          <span class="cyber-nav-label">{{ item.label }}</span>
          <div v-if="isActive(item.to)" class="cyber-nav-indicator" />
        </NuxtLink>
      </nav>

      <!-- Footer -->
      <div class="cyber-sidebar-footer">
        <div class="cyber-conn-status" :class="connected ? 'cyber-conn--ok' : 'cyber-conn--err'">
          <span class="cyber-conn-dot" />
          <span class="cyber-conn-label">{{ connected ? 'CONNECTED' : 'OFFLINE' }}</span>
        </div>
      </div>
    </aside>

    <!-- Mobile header -->
    <header class="cyber-mobile-header">
      <button class="cyber-sidebar-toggle" @click="mobileOpen = !mobileOpen">
        <UIcon :name="mobileOpen ? 'i-lucide-x' : 'i-lucide-menu'" class="size-5" />
      </button>
      <span class="cyber-mobile-brand">
        <span class="cyber-brand-ari">ARI</span><span class="cyber-brand-link">LINK</span>
      </span>
      <div class="cyber-conn-status cyber-conn-status--mini" :class="connected ? 'cyber-conn--ok' : 'cyber-conn--err'">
        <span class="cyber-conn-dot" />
      </div>
    </header>

    <!-- Mobile overlay -->
    <Transition name="fade">
      <div v-if="mobileOpen" class="cyber-mobile-overlay" @click="mobileOpen = false" />
    </Transition>
    <Transition name="slide-in">
      <aside v-if="mobileOpen" class="cyber-sidebar cyber-sidebar--mobile">
        <div class="cyber-sidebar-header">
          <NuxtLink to="/" class="cyber-sidebar-home" @click="mobileOpen = false">
            <div class="cyber-sidebar-logo">
              <UIcon name="i-lucide-radio" class="size-5" />
            </div>
            <span class="cyber-sidebar-brand">
              <span class="cyber-brand-ari">ARI</span><span class="cyber-brand-link">LINK</span>
            </span>
          </NuxtLink>
          <button class="cyber-sidebar-toggle" @click="mobileOpen = false">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </div>
        <nav class="cyber-sidebar-nav">
          <NuxtLink
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            class="cyber-nav-item"
            :class="{ 'cyber-nav-item--active': isActive(item.to) }"
            @click="mobileOpen = false"
          >
            <div class="cyber-nav-icon">
              <UIcon :name="item.icon" class="size-4" />
            </div>
            <span class="cyber-nav-label">{{ item.label }}</span>
            <div v-if="isActive(item.to)" class="cyber-nav-indicator" />
          </NuxtLink>
        </nav>
        <div class="cyber-sidebar-footer">
          <div class="cyber-conn-status" :class="connected ? 'cyber-conn--ok' : 'cyber-conn--err'">
            <span class="cyber-conn-dot" />
            <span class="cyber-conn-label">{{ connected ? 'CONNECTED' : 'OFFLINE' }}</span>
          </div>
        </div>
      </aside>
    </Transition>

    <!-- Main content -->
    <main class="cyber-main" :class="{ 'cyber-main--collapsed': collapsed }">
      <slot />
    </main>

    <!-- Softphone (persistent) -->
    <SoftphoneBar />
  </div>
</template>

<script setup lang="ts">
const { connected } = useSocket();
const route = useRoute();

const collapsed = ref(false);
const mobileOpen = ref(false);

function isActive(to: string): boolean {
  return route.path === to;
}

const navItems = [
  { label: "DASHBOARD", icon: "i-lucide-layout-dashboard", to: "/" },

  { label: "CALLS", icon: "i-lucide-phone", to: "/calls" },
  { label: "ASSETS", icon: "i-lucide-folder-open", to: "/assets" },
  { label: "TERMINAL", icon: "i-lucide-terminal", to: "/terminal" },
  { label: "CAMPAIGNS", icon: "i-lucide-megaphone", to: "/campaigns" },
  { label: "CONTACTS", icon: "i-lucide-contact", to: "/contacts" },
  { label: "ASSISTANTS", icon: "i-lucide-bot", to: "/assistants" },
  { label: "LOGS", icon: "i-lucide-scroll-text", to: "/logs" },
  { label: "CONFIG", icon: "i-lucide-settings", to: "/config" },
  { label: "DOCS", icon: "i-lucide-book-open", to: "/docs" },
];
</script>

<style scoped>
/* ═══════════════════════════════════════
   CYBERPUNK LAYOUT — clip-only collapse
   Only the sidebar width animates.
   Inner content stays full-size and gets
   clipped by overflow:hidden. Zero reflow.
   ═══════════════════════════════════════ */

.cyber-layout {
  --cyber-cyan: #00f0ff;
  --cyber-purple: #9d4edd;
  --cyber-green: #00ff9d;
  --cyber-red: #ff003c;
  --cyber-yellow: #fcee0a;
  --cyber-bg: #0e1018;
  --cyber-bg-sidebar: #0b0d14;
  --cyber-border: #252a3a;
  --cyber-text: #d0d4e0;
  --cyber-text-bright: #eef0f6;
  --cyber-text-muted: #727a92;
  --sidebar-w: 220px;
  --sidebar-c: 52px;

  display: flex;
  min-height: 100vh;
  background: var(--cyber-bg);
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', monospace;
}

/* ─── Sidebar shell ─── */
.cyber-sidebar {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: var(--sidebar-w);
  background: var(--cyber-bg-sidebar);
  border-right: 1px solid var(--cyber-border);
  display: flex;
  flex-direction: column;
  z-index: 40;
  overflow: hidden;           /* THIS does all the work on collapse */
  transition: width 0.2s ease;
}

.cyber-sidebar--collapsed {
  width: var(--sidebar-c);
}

.cyber-sidebar--mobile {
  position: fixed;
  width: 240px;
  z-index: 51;
}

/* ─── Header ───
   Fixed min-width so it never reflows.
   When sidebar shrinks, the right side just gets clipped. */
.cyber-sidebar-header {
  display: flex;
  align-items: center;
  padding: 0.625rem;
  border-bottom: 1px solid var(--cyber-border);
  min-height: 48px;
  min-width: var(--sidebar-w);
  gap: 0.5rem;
}

.cyber-sidebar-home {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  text-decoration: none;
  white-space: nowrap;
}

.cyber-sidebar-logo {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: rgba(0, 240, 255, 0.08);
  border: 1px solid rgba(0, 240, 255, 0.2);
  color: var(--cyber-cyan);
  flex-shrink: 0;
}

.cyber-sidebar-brand {
  font-size: 1rem;
  font-weight: 900;
  letter-spacing: 0.1em;
  white-space: nowrap;
}

.cyber-brand-ari { color: var(--cyber-text-bright); }
.cyber-brand-link { color: var(--cyber-cyan); text-shadow: 0 0 8px rgba(0, 240, 255, 0.4); }

.cyber-sidebar-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 4px;
  border: 1px solid var(--cyber-border);
  background: transparent;
  color: var(--cyber-text-muted);
  cursor: pointer;
  flex-shrink: 0;
}

.cyber-sidebar-toggle:hover {
  color: var(--cyber-cyan);
  border-color: rgba(0, 240, 255, 0.3);
}

/* ─── Navigation ───
   Each row has min-width so it never wraps or shifts.
   Sidebar overflow clips the labels when collapsed. */
.cyber-sidebar-nav {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.cyber-sidebar-nav::-webkit-scrollbar { width: 2px; }
.cyber-sidebar-nav::-webkit-scrollbar-thumb { background: var(--cyber-border); }

.cyber-nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.4375rem 0.5rem;
  border-radius: 4px;
  color: var(--cyber-text-muted);
  text-decoration: none;
  white-space: nowrap;
  min-width: calc(var(--sidebar-w) - 1rem);  /* prevent reflow */
}

.cyber-nav-item:hover {
  color: var(--cyber-text);
  background: rgba(0, 240, 255, 0.04);
}

.cyber-nav-item--active {
  color: var(--cyber-cyan);
  background: rgba(0, 240, 255, 0.08);
}

.cyber-nav-icon {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.cyber-nav-label {
  font-size: 0.6rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  white-space: nowrap;
}

.cyber-nav-indicator {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 14px;
  background: var(--cyber-cyan);
  box-shadow: 0 0 8px rgba(0, 240, 255, 0.5);
  border-radius: 1px;
}

/* ─── Footer ───
   Same min-width trick — stays full width, gets clipped. */
.cyber-sidebar-footer {
  padding: 0.625rem;
  border-top: 1px solid var(--cyber-border);
  min-width: var(--sidebar-w);
}

.cyber-conn-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem;
  border-radius: 4px;
  border: 1px solid var(--cyber-border);
  white-space: nowrap;
}

.cyber-conn-status--mini { border: none; padding: 0; }

.cyber-conn--ok { border-color: rgba(0, 255, 157, 0.2); }
.cyber-conn--err { border-color: rgba(255, 0, 60, 0.2); }

.cyber-conn-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  animation: pulse-dot 2s ease-in-out infinite;
}

.cyber-conn--ok .cyber-conn-dot { background: var(--cyber-green); box-shadow: 0 0 6px var(--cyber-green); }
.cyber-conn--err .cyber-conn-dot { background: var(--cyber-red); box-shadow: 0 0 6px var(--cyber-red); }

.cyber-conn-label {
  font-size: 0.55rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  white-space: nowrap;
}

.cyber-conn--ok .cyber-conn-label { color: var(--cyber-green); }
.cyber-conn--err .cyber-conn-label { color: var(--cyber-red); }

/* ─── Main Content ─── */
.cyber-main {
  margin-left: var(--sidebar-w);
  flex: 1;
  min-height: 100vh;
  transition: margin-left 0.2s ease;
}

.cyber-main--collapsed {
  margin-left: var(--sidebar-c);
}

/* ─── Mobile ─── */
.cyber-mobile-header {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 48px;
  background: var(--cyber-bg-sidebar);
  border-bottom: 1px solid var(--cyber-border);
  align-items: center;
  justify-content: space-between;
  padding: 0 0.75rem;
  z-index: 40;
}

.cyber-mobile-brand {
  font-size: 0.9rem;
  font-weight: 900;
  letter-spacing: 0.1em;
}

.cyber-mobile-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  z-index: 50;
}

@media (max-width: 1023px) {
  .cyber-sidebar:not(.cyber-sidebar--mobile) { display: none; }
  .cyber-mobile-header { display: flex; }
  .cyber-main,
  .cyber-main--collapsed { margin-left: 0; padding-top: 48px; }
}

/* ─── Transitions (mobile only) ─── */
.fade-enter-active,
.fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from,
.fade-leave-to { opacity: 0; }

.slide-in-enter-active,
.slide-in-leave-active { transition: transform 0.25s ease; }
.slide-in-enter-from,
.slide-in-leave-to { transform: translateX(-100%); }

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
