'use client'

import type { ReactNode } from 'react'
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast'
import { useToast } from '@/hooks/use-toast'
import { useLanguage } from '@/components/providers/language-provider'

export function Toaster() {
  const { toasts } = useToast()
  const { t } = useLanguage()

  /**
   * Toast copy is translated here, once, rather than at every call site: a
   * message raised from a hook, a route handler callback or a service function
   * has no locale of its own, and the same message is raised from dozens of
   * places. Strings only — any node a caller passes through (JSX, a formatted
   * amount) is rendered untouched.
   */
  const localize = (node: ReactNode) => (typeof node === 'string' ? t(node) : node)

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{localize(title)}</ToastTitle>}
              {description && <ToastDescription>{localize(description)}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
