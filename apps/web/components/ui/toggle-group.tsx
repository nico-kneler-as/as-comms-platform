"use client"

import * as React from "react"
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group"
import { type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { toggleVariants } from "@/components/ui/toggle"

type PrimitiveWithRef = React.ForwardRefExoticComponent<
  Record<string, unknown> & React.RefAttributes<HTMLElement>
>

const ToggleGroupRootPrimitive =
  ToggleGroupPrimitive.Root as unknown as PrimitiveWithRef
const ToggleGroupItemPrimitive =
  ToggleGroupPrimitive.Item as unknown as PrimitiveWithRef

type ToggleGroupProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof toggleVariants> & {
    type?: "single" | "multiple"
    value?: string | string[]
    onValueChange?: (value: string | string[]) => void
  }
type ToggleGroupItemProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof toggleVariants> & {
    value?: string
  }

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants>
>({
  size: "default",
  variant: "default",
})

const ToggleGroup = React.forwardRef<
  HTMLElement,
  ToggleGroupProps
>(({ className, variant, size, children, ...props }, ref) => (
  <ToggleGroupRootPrimitive
    ref={ref}
    className={cn("flex items-center justify-center gap-1", className)}
    {...props}
  >
    <ToggleGroupContext.Provider value={{ variant, size }}>
      {children}
    </ToggleGroupContext.Provider>
  </ToggleGroupRootPrimitive>
))

ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName

const ToggleGroupItem = React.forwardRef<
  HTMLElement,
  ToggleGroupItemProps
>(({ className, children, variant, size, ...props }, ref) => {
  const context = React.useContext(ToggleGroupContext)

  return (
    <ToggleGroupItemPrimitive
      ref={ref}
      className={cn(
        toggleVariants({
          variant: context.variant ?? variant,
          size: context.size ?? size,
        }),
        className
      )}
      {...props}
    >
      {children}
    </ToggleGroupItemPrimitive>
  )
})

ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName

export { ToggleGroup, ToggleGroupItem }
