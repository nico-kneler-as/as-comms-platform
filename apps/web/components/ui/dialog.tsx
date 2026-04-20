"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

type PrimitiveNoRef = React.ComponentType<Record<string, unknown>>
type PrimitiveWithRef = React.ForwardRefExoticComponent<
  Record<string, unknown> & React.RefAttributes<HTMLElement>
>

const DialogPortalPrimitive =
  DialogPrimitive.Portal as unknown as PrimitiveNoRef
const DialogOverlayPrimitive =
  DialogPrimitive.Overlay as unknown as PrimitiveWithRef
const DialogContentPrimitive =
  DialogPrimitive.Content as unknown as PrimitiveWithRef
const DialogTitlePrimitive =
  DialogPrimitive.Title as unknown as PrimitiveWithRef
const DialogDescriptionPrimitive =
  DialogPrimitive.Description as unknown as PrimitiveWithRef
const DialogClosePrimitive =
  DialogPrimitive.Close as unknown as PrimitiveWithRef

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

type DialogOverlayProps = React.HTMLAttributes<HTMLDivElement>

const DialogOverlay = React.forwardRef<HTMLElement, DialogOverlayProps>(
  ({ className, ...props }, ref) => (
    <DialogOverlayPrimitive
      ref={ref}
      className={cn(
        "fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
)
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

type DialogContentProps = React.HTMLAttributes<HTMLDivElement> & {
  onOpenAutoFocus?: (event: Event) => void
  onCloseAutoFocus?: (event: Event) => void
  onEscapeKeyDown?: (event: KeyboardEvent) => void
  onPointerDownOutside?: (event: Event) => void
  onInteractOutside?: (event: Event) => void
}

const DialogContent = React.forwardRef<HTMLElement, DialogContentProps>(
  ({ className, children, ...props }, ref) => (
    <DialogPortalPrimitive>
      <DialogOverlay />
      <DialogContentPrimitive
        ref={ref}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 border border-slate-200 bg-white p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-lg",
          className
        )}
        {...props}
      >
        {children}
        <DialogClosePrimitive
          className={cn(
            "absolute right-4 top-4 rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 disabled:pointer-events-none"
          )}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogClosePrimitive>
      </DialogContentPrimitive>
    </DialogPortalPrimitive>
  )
)
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col space-y-1.5 text-left", className)}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

type DialogTitleProps = React.HTMLAttributes<HTMLHeadingElement>

const DialogTitle = React.forwardRef<HTMLElement, DialogTitleProps>(
  ({ className, ...props }, ref) => (
    <DialogTitlePrimitive
      ref={ref}
      className={cn(
        "text-base font-semibold leading-none tracking-tight text-slate-900",
        className
      )}
      {...props}
    />
  )
)
DialogTitle.displayName = DialogPrimitive.Title.displayName

type DialogDescriptionProps = React.HTMLAttributes<HTMLParagraphElement>

const DialogDescription = React.forwardRef<
  HTMLElement,
  DialogDescriptionProps
>(({ className, ...props }, ref) => (
  <DialogDescriptionPrimitive
    ref={ref}
    className={cn("text-sm text-slate-500", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
