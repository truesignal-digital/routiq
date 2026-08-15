import { waitFor } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

/**
 * Opens a Base UI select and waits for its list to mount.
 *
 * The popup lives in a portal that appears a frame after the click, so keys
 * sent straight after `user.click` reach a still-closed trigger: the ArrowDown
 * opens the list and the Enter arrives before anything is highlighted, leaving
 * the field unset. userEvent's inter-event hops normally cover the gap, which
 * is why the race only surfaces on an idle machine — a file run on its own.
 *
 * The trigger's own `aria-expanded` is the signal rather than the popup's role:
 * a screen can hold another listbox, and only this trigger says whether *its*
 * list is up.
 */
export async function openSelect(user: UserEvent, trigger: HTMLElement): Promise<void> {
  await user.click(trigger);
  await waitFor(() => {
    if (trigger.getAttribute("aria-expanded") !== "true") {
      throw new Error("The select popup did not open.");
    }
  });
}
