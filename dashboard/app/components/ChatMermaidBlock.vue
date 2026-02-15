<template>
  <div ref="containerRef" class="mermaid-block bg-(--ui-bg-elevated) p-3 overflow-x-auto" />
</template>

<!-- Module-level: shared across ALL instances, survives navigation -->
<script lang="ts">
let mermaidModule: any = null;
let mmInitialized = false;
let mmLastTheme = "";

// Eager preload — starts loading the moment any page imports this component
const mermaidReady = import("mermaid").then((m) => {
  mermaidModule = m.default;
  return mermaidModule;
});

// Persists across navigations: theme::code → { html, height }
const svgCache = new Map<string, { html: string; height: number }>();
</script>

<script setup lang="ts">
const props = defineProps<{ code: string }>();

const colorMode = useColorMode();
const containerRef = ref<HTMLElement | null>(null);

function cacheKey() {
  return `${colorMode.value}::${props.code}`;
}

async function ensureMermaid() {
  if (!mermaidModule) {
    await mermaidReady;
  }
  const isDark = colorMode.value === "dark";
  const theme = isDark ? "dark" : "light";
  if (!mmInitialized || theme !== mmLastTheme) {
    mermaidModule.initialize({
      startOnLoad: false,
      theme: "base",
      securityLevel: "loose",
      suppressErrorRendering: true,
      flowchart: { useMaxWidth: false, htmlLabels: true, padding: 15 },
      themeVariables: isDark
        ? {
            primaryColor: "#2d4a3e",
            primaryTextColor: "#e2e8f0",
            primaryBorderColor: "#4ade80",
            secondaryColor: "#2d3748",
            secondaryTextColor: "#e2e8f0",
            secondaryBorderColor: "#64748b",
            tertiaryColor: "#1e293b",
            tertiaryTextColor: "#e2e8f0",
            lineColor: "#64748b",
            textColor: "#e2e8f0",
            mainBkg: "#1e293b",
            nodeBorder: "#4ade80",
            clusterBkg: "#1a2332",
            clusterBorder: "#334155",
            titleColor: "#e2e8f0",
            edgeLabelBackground: "#1e293b",
            nodeTextColor: "#e2e8f0",
            fontSize: "14px",
          }
        : {
            primaryColor: "#dcfce7",
            primaryTextColor: "#1e293b",
            primaryBorderColor: "#22c55e",
            secondaryColor: "#f1f5f9",
            secondaryTextColor: "#1e293b",
            secondaryBorderColor: "#94a3b8",
            tertiaryColor: "#e2e8f0",
            tertiaryTextColor: "#1e293b",
            lineColor: "#64748b",
            textColor: "#1e293b",
            mainBkg: "#f0fdf4",
            nodeBorder: "#22c55e",
            clusterBkg: "#f8fafc",
            clusterBorder: "#cbd5e1",
            titleColor: "#1e293b",
            edgeLabelBackground: "#ffffff",
            nodeTextColor: "#1e293b",
            fontSize: "14px",
          },
    });
    mmInitialized = true;
    mmLastTheme = theme;
  }
  return mermaidModule;
}

async function renderDiagram() {
  const el = containerRef.value;
  if (!el || !props.code.trim()) return;

  const key = cacheKey();
  const cached = svgCache.get(key);

  if (cached) {
    // Set height first to prevent layout shift, then inject SVG
    el.style.height = cached.height + "px";
    el.innerHTML = cached.html;
    // Delay class so the fade-in transition plays
    requestAnimationFrame(() => el.classList.add("rendered"));
    return;
  }

  try {
    const mm = await ensureMermaid();
    await mm.parse(props.code);

    const id = `mmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const { svg } = await mm.render(id, props.code, el);
    const html = `<div style="display:flex;justify-content:center">${svg}</div>`;
    el.innerHTML = html;

    // Measure and cache height + html for future instant renders
    const height = el.scrollHeight;
    svgCache.set(key, { html, height });
  } catch (e: any) {
    const msg =
      (e?.message || String(e))
        .replace(/\n?mermaid version[\s\S]*$/, "")
        .trim() || "Invalid diagram syntax";
    el.innerHTML = `<div style="font-size:12px;opacity:0.5;font-family:monospace;white-space:pre-wrap"><span style="color:var(--ui-error)">mermaid:</span> ${msg}</div>`;
    console.warn("[Mermaid] Parse/render failed:", msg, "\nCode:", props.code);
  }

  // Fade in after render
  requestAnimationFrame(() => el.classList.add("rendered"));

  // Clean up orphaned mermaid elements
  document
    .querySelectorAll('body > svg[id^="mmd-"], body > div[id^="dmmd-"]')
    .forEach((n) => n.remove());
}

watch(
  () => colorMode.value,
  () => {
    svgCache.clear();
    renderDiagram();
  },
);
watch(() => props.code, () => renderDiagram());
onMounted(() => renderDiagram());
</script>

<style>
.mermaid-block {
  opacity: 0;
  transition: opacity 0.15s ease;
}
.mermaid-block.rendered {
  opacity: 1;
}
</style>
