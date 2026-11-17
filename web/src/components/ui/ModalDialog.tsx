import { useEffect, useRef, type ReactNode } from 'react'

export interface ModalDialogProps {
  open?: boolean
  onClose: () => void
  titleId?: string
  ariaLabel?: string
  closeOnBackdrop?: boolean
  className?: string
  children: ReactNode
}

export default function ModalDialog({
  open = true,
  onClose,
  titleId,
  ariaLabel,
  closeOnBackdrop = true,
  className = '',
  children,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    let unmounted = false

    const handleClose = () => {
      dialog.returnValue = ''
      if (!unmounted) {
        onCloseRef.current()
      }
    }

    const handleCancel = (event: Event) => {
      if (dialog.querySelector('[role="listbox"]')) {
        event.preventDefault()
      }
    }

    dialog.addEventListener('close', handleClose)
    dialog.addEventListener('cancel', handleCancel)

    return () => {
      unmounted = true
      dialog.removeEventListener('close', handleClose)
      dialog.removeEventListener('cancel', handleCancel)
      if (dialog.open) {
        dialog.close()
      }
    }
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open) {
      if (!dialog.open) {
        dialog.showModal()
      }
    } else if (dialog.open) {
      dialog.close()
    }
  }, [open])

  useEffect(() => {
    const dialog = dialogRef.current
    if (
      !dialog ||
      !closeOnBackdrop ||
      typeof HTMLDialogElement === 'undefined' ||
      'closedBy' in HTMLDialogElement.prototype
    ) {
      return
    }

    const isOutsideBounds = (event: PointerEvent): boolean => {
      if (event.target !== dialog) return false
      const rect = dialog.getBoundingClientRect()
      return (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
    }

    let pressedOutside = false
    const handlePointerDown = (event: PointerEvent) => {
      pressedOutside = isOutsideBounds(event)
    }
    const handlePointerUp = (event: PointerEvent) => {
      if (pressedOutside && isOutsideBounds(event)) {
        dialog.close()
      }
      pressedOutside = false
    }

    dialog.addEventListener('pointerdown', handlePointerDown)
    dialog.addEventListener('pointerup', handlePointerUp)
    return () => {
      dialog.removeEventListener('pointerdown', handlePointerDown)
      dialog.removeEventListener('pointerup', handlePointerUp)
    }
  }, [closeOnBackdrop])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-label={!titleId ? ariaLabel : undefined}
      {...({ closedby: closeOnBackdrop ? 'any' : 'closerequest' } as Record<string, string>)}
      className={`m-auto p-0 max-w-none max-h-none open:flex flex-col rounded-2xl border-[1.5px] border-[#1f1f1f] bg-white text-[#1f1f1f] shadow-[6px_6px_0px_#1f1f1f] overflow-hidden backdrop:bg-black/40 backdrop:backdrop-blur-xs ${className}`}
    >
      {children}
    </dialog>
  )
}
