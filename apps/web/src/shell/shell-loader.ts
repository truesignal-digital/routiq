import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { approvalChainQueryOptions } from "../approval-rules/useApprovalChain.js";
import { assetRegistrationReferenceQueryOptions } from "../assets/reference.js";
import { meQueryOptions, type MeContext } from "../auth/me.js";
import { sessionStore } from "../auth/store.js";
import { i18n } from "../i18n/index.js";
import { applyPresetVocabulary, presetVocabularyFor } from "../i18n/preset-overlay.js";

/**
 * What the shell needs before it draws, so nothing in it moves once drawn
 * (#495): the member (sidebar rows, header crumbs and the preset's words), the
 * approval chain (the rules notice above the page) and the branches (the
 * header's switcher). The last two are best-effort: the shell draws without
 * them, as it did before.
 */
export async function loadShell(queryClient: QueryClient, href: string): Promise<MeContext> {
  const session = sessionStore.getActive();
  const slug = session?.workspaceSlug;
  const extras = Promise.allSettled([
    queryClient.ensureQueryData(approvalChainQueryOptions(slug)),
    queryClient.ensureQueryData(assetRegistrationReferenceQueryOptions(slug)),
  ]);
  let me: MeContext;
  try {
    me = await queryClient.ensureQueryData(meQueryOptions(queryClient, session));
  } catch (error) {
    // A dead token ends the session, and clearing the cache cancels this very
    // query, so the error here may be a cancellation, not the 401. Back to
    // the PIN, then here.
    if (sessionStore.getActive() === undefined) throw redirect({ to: "/login", search: { redirect: href } });
    throw error;
  }
  applyPresetVocabulary(i18n, presetVocabularyFor(me.enabledPresets));
  await extras;
  return me;
}
