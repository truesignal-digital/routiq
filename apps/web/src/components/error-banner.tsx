import { AlertCircle } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.js"
import { errorMessage } from "@/lib/error-message.js"

interface ErrorBannerProps {
  code?: string
  message?: string
  title?: string
}

function ErrorBanner({ code, message, title }: ErrorBannerProps) {
  const { i18n } = useTranslation()

  const resolvedMessage = code ? errorMessage(i18n, code) : message

  return (
    <Alert variant="destructive">
      <AlertCircle className="size-4" />
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription>{resolvedMessage}</AlertDescription>
    </Alert>
  )
}

export { ErrorBanner }
