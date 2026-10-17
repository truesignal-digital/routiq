import { createContext, useContext, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PageContainerProps = {
  className?: string;
  children: ReactNode;
};

/**
 * A notice the shell puts at the top of every page (#467). The shell cannot
 * know how wide the page column is, so the page's own container renders it:
 * the notice then lines up with the title on narrow and wide pages alike.
 */
const PageNoticeCtx = createContext<ReactNode>(null);

export function PageNoticeProvider({
  notice,
  children,
}: {
  notice: ReactNode;
  children: ReactNode;
}) {
  return <PageNoticeCtx.Provider value={notice}>{children}</PageNoticeCtx.Provider>;
}

/**
 * The page frame (#658, docs/design/consistency/fullpages.html#frame): every
 * page has the same width, so moving between pages never makes the content
 * jump. At most 1 200 px of content, centred, inside 24 px gutters (1 248 px
 * with them); a phone keeps its 16 px gutters. Screens never set a width of
 * their own (guard DS-5).
 */
export function PageContainer({ className, children }: PageContainerProps) {
  const notice = useContext(PageNoticeCtx);

  return (
    <section
      data-page-frame=""
      className={cn("mx-auto w-full max-w-[1248px] px-4 py-6 sm:px-6", className)}
    >
      {notice}
      {/* A container inside a page (a tab's permission screen) is not a page:
          the notice shows once, in the outermost column. */}
      <PageNoticeCtx.Provider value={null}>{children}</PageNoticeCtx.Provider>
    </section>
  );
}
