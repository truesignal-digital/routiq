import { sessionStore } from "../auth/store.js";
import { endSessionIfSignedOut } from "../auth/sign-out.js";
import { queryClient } from "../lib/query-client.js";
import { createCommandClient, type CommandClient } from "./client.js";
export type { CommandClient } from "./client.js";
import { CommandStatusStore } from "./store.js";

export const commandStatusStore = new CommandStatusStore();

const httpClient = createCommandClient({
  store: commandStatusStore,
  getToken: () => sessionStore.getToken(),
});

/** A command refused for a dead token ends the session, as a read does (`lib/query-client.ts`). */
export const commandClient: CommandClient = {
  async submit(submission) {
    const result = await httpClient.submit(submission);
    if (!result.ok) endSessionIfSignedOut(queryClient, result.code);
    return result;
  },
};
