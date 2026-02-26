<template>
  <div class="min-h-screen bg-(--ui-bg) flex items-center justify-center p-6">
    <div class="w-full max-w-sm">
      <div class="text-center mb-8">
        <div class="flex items-center justify-center gap-3 mb-1">
          <div class="bg-(--ui-primary)/10 p-2 rounded-xl flex">
            <UIcon name="i-lucide-radio" class="size-8 text-(--ui-primary)" />
          </div>
          <h1 class="text-3xl font-bold tracking-tight text-(--ui-text-highlighted)">AriLink</h1>
        </div>
        <p class="text-(--ui-text-muted) text-sm mt-2">Enter your dashboard secret to continue</p>
      </div>

      <UCard>
        <form @submit.prevent="handleLogin">
          <div class="flex flex-col gap-4">
            <UFormField label="Dashboard Secret">
              <UInput
                v-model="secret"
                type="password"
                placeholder="Enter DASHBOARD_SECRET"
                icon="i-lucide-lock"
                autofocus
                :color="error ? 'error' : undefined"
              />
            </UFormField>

            <p v-if="error" class="text-sm text-(--ui-error)">{{ error }}</p>

            <UButton
              type="submit"
              label="Sign In"
              icon="i-lucide-log-in"
              block
              :loading="loading"
            />
          </div>
        </form>
      </UCard>

      <p class="text-center text-xs text-(--ui-text-dimmed) mt-4">
        Set <code class="font-mono bg-(--ui-bg-elevated) px-1 py-0.5 rounded">DASHBOARD_SECRET</code> in your .env file
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: false });

const { login, authenticated, authEnabled } = useAuth();

const secret = ref("");
const error = ref("");
const loading = ref(false);

// If already authenticated or auth not enabled, redirect home
watch(
  [authenticated, authEnabled],
  ([auth, enabled]) => {
    if (auth || !enabled) navigateTo("/");
  },
  { immediate: true }
);

async function handleLogin() {
  error.value = "";
  loading.value = true;
  try {
    await login(secret.value);
    navigateTo("/");
  } catch {
    error.value = "Invalid secret";
  } finally {
    loading.value = false;
  }
}
</script>
