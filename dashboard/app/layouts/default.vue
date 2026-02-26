<template>
  <UDashboardGroup class="text-base">
    <UDashboardSidebar collapsible>
      <template #header="{ collapsed }">
        <div class="flex items-center p-3" :class="collapsed ? 'justify-center' : 'justify-between'">
          <NuxtLink to="/" class="flex items-center gap-2">
            <UIcon name="i-lucide-radio" class="size-6 text-(--ui-primary) shrink-0" />
            <span v-if="!collapsed" class="text-xl font-bold text-(--ui-text-highlighted)">AriLink</span>
          </NuxtLink>
          <UButton
            v-if="!collapsed"
            :icon="colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="toggleColorMode"
          />
        </div>
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu
          :items="navItems"
          :external-icon="false"
          orientation="vertical"
          :ui="collapsed ? { label: 'sr-only' } : {}"
        />
        <div class="mt-auto px-3 pb-2">
          <SidebarCarousel :collapsed="collapsed ?? false" />
        </div>
      </template>

      <template #footer="{ collapsed }">
        <div class="p-3 flex flex-col gap-2">
          <div class="flex items-center" :class="collapsed ? 'justify-center' : 'justify-between'">
            <UBadge
              :color="connected ? 'success' : 'error'"
              variant="subtle"
              :label="collapsed ? '' : (connected ? 'Connected' : 'Disconnected')"
              :icon="connected ? 'i-lucide-wifi' : 'i-lucide-wifi-off'"
            />
            <div class="flex items-center gap-1">
              <UButton
                v-if="authEnabled"
                icon="i-lucide-log-out"
                color="neutral"
                variant="ghost"
                size="xs"
                :title="collapsed ? 'Sign out' : undefined"
                @click="logout"
              />
              <UButton
                v-if="collapsed"
                :icon="colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'"
                color="neutral"
                variant="ghost"
                size="xs"
                @click="toggleColorMode"
              />
            </div>
          </div>
        </div>
      </template>
    </UDashboardSidebar>

    <UDashboardPanel>
      <!-- Mobile navbar with hamburger toggle + connection badge -->
      <UDashboardNavbar class="lg:hidden">
        <template #left>
          <span class="text-lg font-bold text-(--ui-text-highlighted)">AriLink</span>
        </template>
        <template #right>
          <div class="flex items-center gap-2">
            <UButton
              :icon="colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="toggleColorMode"
            />
            <UBadge
              :color="connected ? 'success' : 'error'"
              variant="subtle"
              size="md"
              :icon="connected ? 'i-lucide-wifi' : 'i-lucide-wifi-off'"
            />
          </div>
        </template>
      </UDashboardNavbar>

      <div class="p-4 sm:p-6 lg:p-8 overflow-y-auto flex-1">
        <slot />
      </div>
    </UDashboardPanel>
  </UDashboardGroup>

  <!-- Softphone bar (persistent across all pages) -->
  <SoftphoneBar />
</template>

<script setup lang="ts">
const { connected } = useSocket();
const { authEnabled, logout } = useAuth();
const colorMode = useColorMode();

function toggleColorMode() {
  document.documentElement.classList.add("color-mode-transition");
  colorMode.preference = colorMode.value === "dark" ? "light" : "dark";
  setTimeout(() => document.documentElement.classList.remove("color-mode-transition"), 300);
}

const navItems = computed(() => [
  [
    {
      label: "Dashboard",
      icon: "i-lucide-layout-dashboard",
      to: "/",
    },
    {
      label: "Dashboard v2",
      icon: "i-lucide-monitor",
      to: "/dashboardv2",
    },
    {
      label: "Calls",
      icon: "i-lucide-phone",
      to: "/calls",
    },
    {
      label: "Assets",
      icon: "i-lucide-folder-open",
      to: "/assets",
    },
    {
      label: "Terminal",
      icon: "i-lucide-terminal",
      to: "/terminal",
    },
    {
      label: "Campaigns",
      icon: "i-lucide-megaphone",
      to: "/campaigns",
    },
    {
      label: "Contacts",
      icon: "i-lucide-contact",
      to: "/contacts",
    },
    {
      label: "Assistants",
      icon: "i-lucide-bot",
      to: "/assistants",
    },
    {
      label: "Logs",
      icon: "i-lucide-scroll-text",
      to: "/logs",
    },
    {
      label: "Config",
      icon: "i-lucide-settings",
      to: "/config",
    },
    {
      label: "Docs",
      icon: "i-lucide-book-open",
      to: "/docs",
    },
  ],
  [
    {
      label: "Sponsor Me",
      icon: "i-lucide-heart",
      to: "https://github.com/sponsors/alexiokay",
      target: "_blank",
      ui: { linkLeadingIcon: "text-pink-500" },
    },
  ],
]);
</script>
