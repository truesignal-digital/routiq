import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PageContainerProps = {
  width?: "narrow" | "default" | "wide";
  className?: string;
  children: ReactNode;
};

export function PageContainer({
  width = "default",
  className,
  children,
}: PageContainerProps) {
  const widthClass = {
    narrow: "max-w-xl",
    default: "max-w-3xl",
    wide: "max-w-6xl",
  }[width];

  return (
    <section className={cn("mx-auto w-full px-4 py-6", widthClass, className)}>
      {children}
    </section>
  );
}
