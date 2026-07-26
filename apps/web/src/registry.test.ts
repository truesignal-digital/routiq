import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

interface RegistryItem {
  name: string;
  type: string;
  files: Array<{ path: string; type: string }>;
  registryDependencies?: string[];
  dependencies?: string[];
}

interface Registry {
  $schema: string;
  name: string;
  homepage: string;
  items: RegistryItem[];
}

describe("registry.json", () => {
  const registryPath = resolve(__dirname, "../registry.json");
  const registry: Registry = JSON.parse(readFileSync(registryPath, "utf-8"));

  it("should be valid JSON with expected schema", () => {
    expect(registry).toHaveProperty("$schema");
    expect(registry).toHaveProperty("name", "routiq");
    expect(registry).toHaveProperty("homepage");
    expect(Array.isArray(registry.items)).toBe(true);
  });

  it("should have at least 20 items", () => {
    expect(registry.items.length).toBeGreaterThanOrEqual(20);
  });

  describe("each item", () => {
    registry.items.forEach((item) => {
      describe(`${item.name} (${item.type})`, () => {
        it("should have required properties", () => {
          expect(item).toHaveProperty("name");
          expect(item).toHaveProperty("type");
          expect(item).toHaveProperty("files");
          expect(Array.isArray(item.files)).toBe(true);
          expect(item.files.length).toBeGreaterThan(0);
        });

        it("should have registryDependencies array", () => {
          expect(Array.isArray(item.registryDependencies)).toBe(true);
        });

        it("should have dependencies array", () => {
          expect(Array.isArray(item.dependencies)).toBe(true);
        });

        it("should have all files existing on disk", () => {
          item.files.forEach((file) => {
            const filePath = resolve(__dirname, "..", file.path);
            try {
              readFileSync(filePath, "utf-8");
            } catch (err) {
              throw new Error(
                `File not found for item "${item.name}": ${file.path}`
              );
            }
          });
        });

        it("should have valid registry dependencies", () => {
          const itemNames = new Set(registry.items.map((i) => i.name));
          item.registryDependencies?.forEach((dep) => {
            if (!itemNames.has(dep)) {
              throw new Error(
                `Item "${item.name}" depends on "${dep}" which does not exist in registry`
              );
            }
          });
        });
      });
    });
  });

  it("should not have duplicate item names", () => {
    const names = registry.items.map((item) => item.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});
