"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

type PrimitiveNoRef = React.ComponentType<Record<string, unknown>>
type PrimitiveWithRef = React.ForwardRefExoticComponent<
  Record<string, unknown> & React.RefAttributes<HTMLElement>
>

const ProgressRootPrimitive =
  ProgressPrimitive.Root as unknown as PrimitiveWithRef
const ProgressIndicatorPrimitive =
  ProgressPrimitive.Indicator as unknown as PrimitiveNoRef

type ProgressProps = React.HTMLAttributes<HTMLDivElement> & {
  value?: number
}

const Progress = React.forwardRef<
  HTMLElement,
  ProgressProps
>(({ className, value, ...props }, ref) => (
  <ProgressRootPrimitive
    ref={ref}
    className={cn(
      "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
      className
    )}
    {...props}
  >
    <ProgressIndicatorPrimitive
      className="h-full w-full flex-1 bg-primary transition-all"
      style={{ transform: `translateX(-${(100 - (value ?? 0)).toString()}%)` }}
    />
  </ProgressRootPrimitive>
))
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
