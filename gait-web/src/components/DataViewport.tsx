import { useEffect, useRef, type ReactNode } from "react";

export default function DataViewport({ className, label, resetKey, children }: {
  className: string; label: string; resetKey: string; children: ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [resetKey]);
  return <div ref={viewportRef} className={className} tabIndex={0} role="region" aria-label={label}>{children}</div>;
}
