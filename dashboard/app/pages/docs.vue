<template>
  <div class="h-[calc(100vh-160px)] flex flex-col overflow-hidden">
    <!-- Header -->
    <div class="flex items-center gap-3 mb-5 shrink-0">
      <div class="p-2 items-center justify-center flex rounded-lg bg-(--ui-primary)/10">
        <UIcon name="i-lucide-book-open" class="size-6 text-(--ui-primary)" />
      </div>
      <div>
        <h1 class="text-2xl font-bold text-(--ui-text-highlighted)">Documentation</h1>
        <p class="text-xs text-(--ui-text-dimmed)">Use cases, workflows, and configuration guides</p>
      </div>
    </div>

    <div class="flex flex-1 gap-0 min-h-0">
      <!-- Sidebar TOC -->
      <nav v-if="navItems.length" class="w-56 shrink-0 overflow-y-auto border-r border-(--ui-border) pr-4 mr-6 space-y-0.5">
        <NuxtLink
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all duration-150"
          :class="isActive(item.path)
            ? 'bg-(--ui-primary)/10 text-(--ui-primary) font-semibold shadow-sm'
            : 'hover:bg-(--ui-bg-elevated) text-(--ui-text-dimmed) hover:text-(--ui-text)'"
        >
          <UIcon
            :name="item.icon || 'i-lucide-file-text'"
            class="size-4 shrink-0"
            :class="isActive(item.path) ? 'text-(--ui-primary)' : ''"
          />
          {{ item.title }}
        </NuxtLink>
      </nav>

      <!-- Content area -->
      <div class="flex-1 overflow-y-auto pr-2 pb-10 pl-2">
        <NuxtPage />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute();
const { data: navigation } = await useAsyncData("docs-nav", () =>
  queryCollectionNavigation("docs"),
);

// queryCollectionNavigation may return nested tree — flatten to leaf pages
const navItems = computed(() => {
  if (!navigation.value) return [];
  return flattenNav(navigation.value);
});

function flattenNav(items: any[]): any[] {
  const result: any[] = [];
  for (const item of items) {
    if (item.children?.length) {
      result.push(...flattenNav(item.children));
    } else {
      result.push(item);
    }
  }
  return result;
}

function isActive(path: string): boolean {
  return route.path === path || route.path.startsWith(path + "/");
}
</script>
