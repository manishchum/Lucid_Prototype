"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

const Trace = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="trace"
      className={cn("flex flex-col gap-1 w-full text-xs sm:text-sm", className)}
      {...props}
    />
  )
)
Trace.displayName = "Trace"

const traceLineVariants = cva(
  "group/trace-line flex items-center gap-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground cursor-pointer select-none",
  {
    variants: {
      status: {
        running: "text-foreground font-medium",
        error: "text-destructive font-medium",
        success: "text-muted-foreground",
        pending: "opacity-60",
      },
    },
    defaultVariants: {
      status: undefined,
    },
  }
)

export interface TraceLineProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof traceLineVariants> {}

const TraceLine = React.forwardRef<HTMLDivElement, TraceLineProps>(
  ({ className, status, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-slot="trace-line"
        className={cn(traceLineVariants({ status }), className)}
        {...props}
      >
        {children}
      </div>
    )
  }
)
TraceLine.displayName = "TraceLine"

const TraceIcon = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      data-slot="trace-icon"
      className={cn(
        "inline-flex items-center justify-center shrink-0 [&_svg]:size-3.5 text-muted-foreground group-hover/trace-line:text-foreground transition-colors",
        className
      )}
      {...props}
    />
  )
)
TraceIcon.displayName = "TraceIcon"

const TraceTitle = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      data-slot="trace-title"
      className={cn(
        "font-serif italic text-slate-500 group-hover/trace-line:text-slate-800 transition-colors",
        className
      )}
      {...props}
    />
  )
)
TraceTitle.displayName = "TraceTitle"

const TraceDescription = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      data-slot="trace-description"
      className={cn("text-[11px] text-slate-400 group-hover/trace-line:text-slate-500 transition-colors font-mono", className)}
      {...props}
    />
  )
)
TraceDescription.displayName = "TraceDescription"

const TraceCollapsible = Collapsible
const TraceCollapsibleTrigger = CollapsibleTrigger

const TraceCollapsibleContent = React.forwardRef<
  React.ElementRef<typeof CollapsibleContent>,
  React.ComponentPropsWithoutRef<typeof CollapsibleContent>
>(({ className, children, ...props }, ref) => (
  <CollapsibleContent
    ref={ref}
    data-slot="trace-collapsible-content"
    className={cn(
      "overflow-hidden transition-all data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down",
      className
    )}
    {...props}
  >
    {children}
  </CollapsibleContent>
))
TraceCollapsibleContent.displayName = "TraceCollapsibleContent"

export {
  Trace,
  TraceLine,
  TraceIcon,
  TraceTitle,
  TraceDescription,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
}
