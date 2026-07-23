import { sessionStore } from "../auth/store.js";
import { createCommandClient } from "./client.js";
import { CommandStatusStore } from "./store.js";

export const commandStatusStore = new CommandStatusStore();

export const commandClient = createCommandClient({
  store: commandStatusStore,
  getToken: () => sessionStore.getToken(),
});
