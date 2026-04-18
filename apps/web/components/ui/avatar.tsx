"use client"

import * as React from "react"
import * as AvatarPrimitive from "@radix-ui/react-avatar"

import { cn } from "@/lib/utils"

const AvatarRoot = AvatarPrimitive.Root as unknown as React.ForwardRefExoticComponent<
  React.ComponentPropsWithoutRef<"span"> & React.RefAttributes<HTMLSpanElement>
>
const AvatarImagePrimitive =
  AvatarPrimitive.Image as unknown as React.ForwardRefExoticComponent<
    React.ComponentPropsWithoutRef<"img"> &
      React.RefAttributes<HTMLImageElement>
  >
const AvatarFallbackPrimitive =
  AvatarPrimitive.Fallback as unknown as React.ForwardRefExoticComponent<
    React.ComponentPropsWithoutRef<"span"> &
      React.RefAttributes<HTMLSpanElement> & {
        delayMs?: number
      }
  >

const Avatar = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<"span">
>(({ className, ...props }, ref) => (
  <AvatarRoot
    ref={ref}
    className={cn(
      "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
      className
    )}
    {...props}
  />
))
Avatar.displayName = AvatarPrimitive.Root.displayName

const AvatarImage = React.forwardRef<
  HTMLImageElement,
  React.ComponentPropsWithoutRef<"img">
>(({ className, ...props }, ref) => (
  <AvatarImagePrimitive
    ref={ref}
    className={cn("aspect-square h-full w-full", className)}
    {...props}
  />
))
AvatarImage.displayName = AvatarPrimitive.Image.displayName

const AvatarFallback = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<"span"> & {
    delayMs?: number
  }
>(({ className, ...props }, ref) => (
  <AvatarFallbackPrimitive
    ref={ref}
    className={cn(
      "flex h-full w-full items-center justify-center rounded-full bg-muted",
      className
    )}
    {...props}
  />
))
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName

export { Avatar, AvatarImage, AvatarFallback }
