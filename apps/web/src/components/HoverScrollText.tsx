import { useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { cn } from "@/lib/utils"

export function HoverScrollText({ text, className }: { text: string; className?: string }) {
  const viewport = useRef<HTMLSpanElement>(null)
  const content = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(0)
  useLayoutEffect(() => {
    const measure = () => setOverflow(Math.max(0, (content.current?.scrollWidth ?? 0) - (viewport.current?.clientWidth ?? 0)))
    measure()
    const observer = new ResizeObserver(measure)
    if (viewport.current) observer.observe(viewport.current)
    if (content.current) observer.observe(content.current)
    return () => observer.disconnect()
  }, [text])
  return <span ref={viewport} data-hover-scroll-text className={cn("group/title block min-w-0 overflow-hidden text-left", overflow > 0 && "[mask-image:linear-gradient(to_right,black_calc(100%-12px),transparent)] hover:[mask-image:none]", className)}
    style={{ "--title-offset": `${-overflow}px`, "--title-duration": `${Math.max(0.6, overflow / 65)}s` } as CSSProperties}>
    <span ref={content} className="inline-block whitespace-nowrap transition-transform duration-200 ease-out group-hover/title:translate-x-[var(--title-offset)] group-hover/title:delay-300 group-hover/title:duration-[var(--title-duration)] group-hover/title:ease-linear group-focus-within/title:translate-x-[var(--title-offset)] motion-reduce:transition-none">{text}</span>
  </span>
}
