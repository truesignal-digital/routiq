import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { createElement } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./dialog"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
} from "./alert-dialog"
import { Button } from "./button"

describe("Dialog primitive smoke tests", () => {
  it("renders Dialog open with focus trap and footer buttons", () => {
    const TestComponent = () => (
      createElement(Dialog, { open: true }, [
        createElement(DialogContent, { key: "content" }, [
          createElement(DialogHeader, { key: "header" }, [
            createElement(DialogTitle, { key: "title" }, "Test Dialog"),
          ]),
          createElement(DialogFooter, { key: "footer" }, [
            createElement(Button, { key: "cancel", variant: "outline" }, "Cancel"),
            createElement(Button, { key: "submit" }, "Submit"),
          ]),
        ]),
      ])
    )

    render(createElement(TestComponent))

    // Assert focus trap container exists (dialog role)
    const dialogElement = screen.getByRole("dialog")
    expect(dialogElement).toBeDefined()
    expect(dialogElement).toBeInstanceOf(HTMLElement)

    // Assert footer buttons exist
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Submit" })).toBeDefined()
  })

  it("renders AlertDialog open with focus trap and action buttons", () => {
    const TestComponent = () => (
      createElement(AlertDialog, { open: true }, [
        createElement(AlertDialogContent, { key: "content" }, [
          createElement(AlertDialogHeader, { key: "header" }, [
            createElement(AlertDialogTitle, { key: "title" }, "Confirm Action"),
          ]),
          createElement(AlertDialogFooter, { key: "footer" }, [
            createElement(Button, { key: "cancel", variant: "outline" }, "Cancel"),
            createElement(Button, { key: "confirm", variant: "destructive" }, "Confirm"),
          ]),
        ]),
      ])
    )

    render(createElement(TestComponent))

    // Assert alert dialog role exists
    const alertDialogElement = screen.getByRole("alertdialog")
    expect(alertDialogElement).toBeDefined()
    expect(alertDialogElement).toBeInstanceOf(HTMLElement)

    // Assert footer buttons exist
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDefined()
  })
})
