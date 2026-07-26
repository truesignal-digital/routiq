import { useEffect, useState } from "react";

/**
 * Debounces a value by delaying updates for the specified duration.
 * Useful for search inputs, filters, and other user inputs that trigger expensive operations.
 */
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}
