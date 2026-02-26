// Shared server state — populated by the bootstrap plugin, consumed by API routes.
// Nitro auto-imports everything in server/utils/.

interface ServerState {
  controller: any | null;
  callHistory: any | null;
  dashboard: any | null;
  rustProcess: any | null;
  autoDialer: any | null;
  dockerManager: any | null;
}

export const serverState: ServerState = {
  controller: null,
  callHistory: null,
  dashboard: null,
  rustProcess: null,
  autoDialer: null,
  dockerManager: null,
};
