// @vitest-environment jsdom
import { zodResolver } from "@hookform/resolvers/zod";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./form";
import { Input } from "./input";

const schema = z.object({
  reference: z.string().min(1, "Reference is required"),
});

type Values = z.infer<typeof schema>;

function TestForm({ onValid }: { onValid: (values: Values) => void }) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { reference: "" },
  });

  return (
    <Form {...form}>
      <form onSubmit={(event) => void form.handleSubmit(onValid)(event)}>
        <FormField
          control={form.control}
          name="reference"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Reference</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <button type="submit">Save</button>
      </form>
    </Form>
  );
}

afterEach(cleanup);

describe("Form", () => {
  it("passes the controller field down so typing updates form state", async () => {
    const user = userEvent.setup();
    const onValid = vi.fn();
    render(<TestForm onValid={onValid} />);

    await user.type(screen.getByLabelText("Reference"), "R-42");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onValid).toHaveBeenCalledOnce());
    expect(onValid.mock.calls[0]?.[0]).toEqual({ reference: "R-42" });
  });

  it("wires aria-invalid and aria-describedby to the message on a failed submit", async () => {
    const user = userEvent.setup();
    render(<TestForm onValid={vi.fn()} />);

    const input = screen.getByLabelText("Reference");
    expect(input.getAttribute("aria-invalid")).toBe("false");

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(input.getAttribute("aria-invalid")).toBe("true"));
    const message = screen.getByText("Reference is required");
    expect(input.getAttribute("aria-describedby")).toContain(message.id);
  });

  it("renders nothing while the field is valid", async () => {
    const user = userEvent.setup();
    render(<TestForm onValid={vi.fn()} />);

    expect(screen.queryByText("Reference is required")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByText("Reference is required")).toBeDefined(),
    );

    await user.type(screen.getByLabelText("Reference"), "R-42");
    await waitFor(() =>
      expect(screen.queryByText("Reference is required")).toBeNull(),
    );
  });
});
