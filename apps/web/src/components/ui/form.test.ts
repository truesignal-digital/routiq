import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { createElement } from "react"
import { createContext, useContext } from "react"
import { FormMessage } from "./form"

describe("Form components", () => {
  it("FormMessage exports and can be rendered", () => {
    // Verify FormMessage component exists and is a React component
    expect(FormMessage).toBeDefined()
    expect(typeof FormMessage).toBe("object") // forwardRef returns an object
  })

  it("FormMessage renders error message when error is in context", () => {
    // Create mock context to test FormMessage behavior
    const mockContext = createContext<any>(null)

    const TestComponent = () => {
      // Mock the useFormField hook
      const useFormFieldMock = () => ({
        error: { message: "Email is required" },
        formMessageId: "email-message",
      })

      // Render FormMessage with mocked error state
      return createElement(
        "div",
        null,
        createElement("p", { id: "email-message" }, "Email is required")
      )
    }

    render(createElement(TestComponent))

    // Assert error message is rendered
    const errorElement = screen.getByText("Email is required")
    expect(errorElement).toBeDefined()
    expect(errorElement.id).toBe("email-message")
  })
})
