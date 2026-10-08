import { render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { expect, it } from "vitest";
import { Button } from "./components/ui/button.js";

function LoadsSlowly() {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 1_500);
    return () => clearTimeout(timer);
  }, []);
  return <p>{loaded ? "FIN-001" : "Loading"}</p>;
}

// The first render on a loaded CI runner outlasts testing-library's 1 s default (#120, #132).
it("waits past a first render slower than one second", async () => {
  render(<LoadsSlowly />);
  expect((await screen.findByText("FIN-001")).tagName).toBe("P");
});

// #136: Base UI misuse only reaches console.error, so the setup fails the test.
it.fails("fails a test whose render makes Base UI log an error", () => {
  render(
    <Button nativeButton render={<a href="/finance/record" />}>
      Record
    </Button>,
  );
});
