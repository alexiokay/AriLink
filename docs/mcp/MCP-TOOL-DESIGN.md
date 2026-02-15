# 🛠️ MCP Tool Design: Raw ARI vs. AriLink Abstraction

When building MCP tools for this project, you have two choices: Expose the **Raw Asterisk API** or build tools around your **AriLink App Logic**.

---

## ⚖️ The Comparison

### Option 1: Raw ARI Tools (The "Low-Level" approach)
These tools would map 1:1 to Asterisk endpoints (e.g., `POST /channels`, `POST /bridges`). 

*   **Pros**: Complete control. The AI can do anything Asterisk allows.
*   **Cons**: 
    *   **Extremely Verbose**: To "start a call and play audio," the AI would need to make 4-5 tool calls in a row.
    *   **High Latency**: Every step requires a round-trip to the LLM.
    *   **Fragile**: If the AI hallucinates a Channel ID, the system crashes or errors out.

### Option 2: AriLink App Tools (The "Smart Context" approach)
These tools wrap your existing TypeScript classes (`CallSessionManager`, `AutoDialer`, etc.).

*   **Pros**:
    *   **Safety**: The code handles things like "Ensuring the bridge exists before adding a channel."
    *   **Simplicity**: The AI says `start_campaign(list_id)`, and AriLink handles the 50 steps inside.
    *   **Stateful**: AriLink knows which sessions are active; the AI doesn't have to track IDs manually.
*   **Cons**: You have to "hand-write" the tools for each feature.

---

## 🎯 Recommended Hybrid Toolset

I recommend building **App-Level Tools** that hide the complexity of raw ARI.

### 🚀 Category A: Campaign & Outbound
Instead of raw "Originate", use:
1.  `start_outbound_campaign(list_file_path)`: Triggers your `AutoDialer.ts` logic.
2.  `stop_campaign(campaign_id)`: Gracefully ends the dialer.
3.  `get_campaign_stats(campaign_id)`: Returns a summary (Answered, Busy, Transferred).

### 🎙️ Category B: Live Call Control
Instead of managing UDP ports and WebSockets, use:
1.  `monitor_live_call(channel_id)`: Tells AriLink to start a `transcriptionProvider` and stream results to the agent.
2.  `inject_voice_prompt(channel_id, prompt_name)`: Plays an existing WAV file from `/custom/`.
3.  `smart_transfer(channel_id, destination)`: Handles the logic of putting the caller on hold, dialing the 3CX trunk, and bridging them.

### 📋 Category C: Information & Discovery
1.  `list_active_sessions()`: Returns your `CallSession` objects (Human-readable names, duration, status).
2.  `search_transcripts(query)`: Searches your local JSON transcription logs.

---

## 🏗️ Technical Architecture Sample

Your MCP tool implementation should look like this:

```typescript
// MCP Tool Definition for "Smart Transfer"
server.tool(
  "smart_transfer",
  { channelId: z.string(), destination: z.string() },
  async ({ channelId, destination }) => {
    // 1. Get the session from your manager
    const session = sessionManager.getSessionByChannelId(channelId);
    if (!session) return { content: [{ type: "text", text: "Session not found" }] };

    // 2. leverage your EXISTING class method
    await ariController.bridgeToDestination(session, destination);

    return { content: [{ type: "text", text: `Successfully transferred to ${destination}` }] };
  }
);
```

## 🏁 Verdict
**Build tools around your APP.** 
Asterisk's raw API is too "noisy" for an LLM to manage reliably. By building tools around `AriLink`, you create a set of "Super Powers" that the AI can use without needing to be an Asterisk certified engineer.
