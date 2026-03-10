const stateLabels: Record<string, string> = {
  idle: "Idle",
  listening: "Listening for speech",
  processing: "Processing input",
  speaking: "Playing audio",
  transferring: "Transferring call",
};

type BadgeColor = "error" | "primary" | "secondary" | "success" | "info" | "warning" | "neutral";
const stateMap: Record<string, { label: string; color: BadgeColor; icon: string }> = {
  idle: { label: "Idle", color: "neutral", icon: "i-lucide-pause" },
  listening: { label: "Listening", color: "success", icon: "i-lucide-ear" },
  processing: { label: "Processing", color: "warning", icon: "i-lucide-loader" },
  speaking: { label: "Speaking", color: "info", icon: "i-lucide-volume-2" },
  transferring: { label: "Transferring", color: "error", icon: "i-lucide-phone-forwarded" },
};

export function useActivity() {
  function activityLabel(entry: { type: string; text: string }): string {
    if (entry.type === "state") {
      const [state, detail] = entry.text.split(":", 2);
      const label = stateLabels[state!] || state;
      return detail ? `${label} → ${detail}` : label!;
    }
    if (entry.type === "transcription") return `"${entry.text}"`;
    if (entry.type === "spoken") return `Bot: "${entry.text}"`;
    if (entry.type === "dtmf") return `DTMF: ${entry.text}`;
    return entry.text;
  }

  function activityIcon(type: string): string {
    if (type === "state") return "i-lucide-arrow-right";
    if (type === "transcription") return "i-lucide-message-square";
    if (type === "spoken") return "i-lucide-volume-2";
    if (type === "dtmf") return "i-lucide-hash";
    return "i-lucide-circle";
  }

  function activityColor(type: string): string {
    if (type === "state") return "text-(--ui-text-dimmed)";
    if (type === "transcription") return "text-(--ui-primary)";
    if (type === "spoken") return "text-(--ui-success)";
    if (type === "dtmf") return "text-(--ui-warning)";
    return "text-(--ui-text-dimmed)";
  }

  function stateInfo(state: string) {
    return stateMap[state] || stateMap.idle;
  }

  function formatActivityTime(ts: number | string): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  return { activityLabel, activityIcon, activityColor, stateInfo, formatActivityTime };
}
