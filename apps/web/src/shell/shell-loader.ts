import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { approvalChainQueryOptions } from "../approval-rules/useApprovalChain.js";
import { assetRegistrationReferenceQueryOptions } from "../reference/asset-registration.js";
import { meQueryOptions, type MeContext } from "../auth/me.js";
import { sessionStore } from "../auth/store.js";
import { i18n } from "../i18n/index.js";
import { applyPresetVocabulary, presetVocabularyFor } from "../i18n/preset-overlay.js";

/**
 * What the shell needs before it draws, so nothing in it moves once drawn
 * (#495): the member (sidebar rows, header crumbs and the preset's words), the
 * approval chain (the rules notice above the page) and the branches (the
 * header's switcher). All three are best-effort past a dead session: offline
 * or on a server error the shell draws without them, as it did before, so the
 * member can still capture, retry or sign out.
 */
export async function loadShell(queryClient: QueryClient, href: string): Promise<MeContext | undefined> {
  const session = sessionStore.getActive();
  const slug = session?.workspaceSlug;
  // One try each, whatever the client's default retry (#600): the shell does
  // not wait out a backoff for them, and their hooks retry once it is drawn.
  const extras = Promise.allSettled([
    queryClient.ensureQueryData({ ...approvalChainQueryOptions(slug), retry: false }),
    queryClient.ensureQueryData({ ...assetRegistrationReferenceQueryOptions(slug), retry: false }),
  ]);
  let me: MeContext;
  try {
    me = await queryClient.ensureQueryData(meQueryOptions(queryClient, session));
  } catch {
    // A dead token ends the session, and clearing the cache cancels this very
    // query, so the error here may be a cancellation, not the 401. Back to
    // the PIN, then here.
    if (sessionStore.getActive() === undefined) throw redirect({ to: "/login", search: { redirect: href } });
    await extras;
    return undefined;
  }
  applyPresetVocabulary(i18n, presetVocabularyFor(me.enabledPresets));
  await extras;
  return me;
}
