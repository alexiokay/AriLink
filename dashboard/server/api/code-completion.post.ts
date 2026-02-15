import { CompletionCopilot } from "monacopilot";

let copilot: InstanceType<typeof CompletionCopilot> | null = null;

function getCopilot() {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) return null;

  if (!copilot) {
    copilot = new CompletionCopilot(key, {
      provider: "mistral",
      model: "codestral",
    });
  }
  return copilot;
}

export default defineEventHandler(async (event) => {
  const pilot = getCopilot();
  if (!pilot) {
    return { completion: null, error: "MISTRAL_API_KEY not configured" };
  }

  const body = await readBody(event);
  const result = await pilot.complete({ body });
  return result;
});
