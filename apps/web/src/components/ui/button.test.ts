import { describe, expect, it } from "vitest";
import { buttonVariants } from "./button";

describe("buttonVariants", () => {
  // Links styled as buttons take the string as is, with no later merge.
  it("keeps the outline border instead of the base's transparent one", () => {
    const classes = buttonVariants({ variant: "outline", size: "desktop-sm" }).split(" ");
    expect(classes).toContain("border-border");
    expect(classes).not.toContain("border-transparent");
  });

  it("keeps the transparent border where no variant sets one", () => {
    expect(buttonVariants().split(" ")).toContain("border-transparent");
  });
});
