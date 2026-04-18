"use client"

import * as React from "react"
import * as SeparatorPrimitive from "@radix-ui/react-separator"

import { cn } from "@/lib/utils"

type PrimitiveWithRef = React.ForwardRefExoticComponent<
  Record<string, unknown> & React.RefAttributes<HTMLElement>
>

const SeparatorRootPrimitive =
  SeparatorPrimitive.Root as unknown as PrimitiveWithRef

type SeparatorProps = React.HTMLAttributes<HTMLDivElement> & {
  decorative?: boolean
  orientation?: "horizontal" | "vertical"
}

const Separator = React.forwardRef<
  HTMLElement,
  SeparatorProps
>(
  (
    { className, orientation = "horizontal", decorative = true, ...props },
    ref
  ) => (
    <SeparatorRootPrimitive
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
        className
      )}
      {...props}
    />
  )
)
Separator.displayName = SeparatorPrimitive.Root.displayName

export { Separator }
