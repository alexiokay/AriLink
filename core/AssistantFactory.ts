import type { IAssistant } from "../assistants/base/AssistantTypes";

/**
 * AssistantFactory
 *
 * Creates the appropriate assistant based on extension routing,
 * explicit type, or caller ID.
 *
 * Assistants are lazy-loaded — to add a new one, just add a case
 * to createByType() with a require() pointing to its folder.
 *
 * Available assistants:
 * - "ivr-transfer": IVR flow (Press 1 → Speak name → Transfer to 3CX)
 * - "direct-dial": Voice → Contact match → Direct dial (original flow)
 */

// Registry of assistant constructors (populated on first use via lazy loading)
const assistantRegistry: Record<string, any> = {};

function getAssistantClass(type: string): any {
  if (!assistantRegistry[type]) {
    switch (type) {
      case "ivr-transfer":
        assistantRegistry[type] = require("../assistants/ivr-transfer/IvrTransferAssistant").IvrTransferAssistant;
        break;
      case "direct-dial":
        assistantRegistry[type] = require("../assistants/direct-dial/DirectDialAssistant").DirectDialAssistant;
        break;
      default:
        // Fall back to ivr-transfer
        return getAssistantClass("ivr-transfer");
    }
  }
  return assistantRegistry[type];
}

class AssistantFactory {
  /**
   * Create assistant by explicit type name
   */
  static createByType(
    type: string,
    client: any,
    sessionId: string,
    contacts?: any
  ): IAssistant {
    const AssistantClass = getAssistantClass(type.toLowerCase());
    return new AssistantClass(client, sessionId, contacts);
  }

  /**
   * Create assistant based on extension routing
   */
  static createFromExtension(
    extension: string,
    client: any,
    sessionId: string,
    contacts?: any
  ): IAssistant {
    // Route by extension range
    // Example: if (ext >= 100 && ext < 200) return AssistantFactory.createByType("direct-dial", ...)

    // Default: IVR transfer for all extensions
    return AssistantFactory.createByType("ivr-transfer", client, sessionId, contacts);
  }

  /**
   * Create assistant based on caller ID (VIP routing, etc.)
   */
  static createFromCallerId(
    callerId: string,
    client: any,
    sessionId: string,
    contacts?: any
  ): IAssistant {
    // Future: Check database or CRM for VIP customers
    // if (isVIPCustomer(callerId)) return AssistantFactory.createByType("vip", ...)

    return AssistantFactory.createByType("ivr-transfer", client, sessionId, contacts);
  }
}

module.exports.AssistantFactory = AssistantFactory;
