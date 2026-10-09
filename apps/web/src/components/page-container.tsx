import { createContext, useContext, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PageContainerProps = {
  width?: "narrow" | "default" | "wide";
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

export function PageContainer({
  width = "default",
  className,
  children,
}: PageContainerProps) {
  const notice = useContext(PageNoticeCtx);
  const widthClass = {
    narrow: "max-w-xl",
    default: "max-w-3xl",
    wide: "max-w-6xl",
  }[width];

  return (
    <section className={cn("mx-auto w-full px-4 py-6", widthClass, className)}>
      {notice}
      {/* A container inside a page (a tab's permission screen) is not a page:
          the notice shows once, in the outermost column. */}
      <PageNoticeCtx.Provider value={null}>{children}</PageNoticeCtx.Provider>
    </section>
  );
}
