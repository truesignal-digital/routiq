import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderCompose, renderViteConfig, storageImageFrom } from "./render.js";
import { PROTECTED_VOLUME, REPO_ROOT, slotPorts } from "./slot.js";

const appliance = readFileSync(path.join(REPO_ROOT, "docker-compose.yml"), "utf8");
const image = storageImageFrom(appliance);

// #108: a fixed volume name made every `-p <project> --profile appliance up` mount the dev database.
describe("docker-compose.yml", () => {
  it("leaves volume names to the compose project", () => {
    const volumes = appliance.slice(appliance.search(/^volumes:$/m));
    expect(volumes).toMatch(/^volumes:\n/);
    expect(volumes).not.toMatch(/^\s+name:/m);
  });
});

describe("renderCompose", () => {
  const yaml = renderCompose("routiq-verify-3", slotPorts(3), image, { accessKey: "a", secretKey: "b" });

  it("uses the storage image docker-compose.yml pins", () => {
    expect(image).toMatch(/^rustfs\/rustfs@sha256:[0-9a-f]{64}$/);
    expect(yaml).toContain(`image: ${image}`);
  });

  it("names its own project and leaves volume names to it", () => {
    expect(yaml).toContain("name: routiq-verify-3");
    expect(yaml).not.toContain(PROTECTED_VOLUME);
    expect(yaml).toMatch(/volumes:\n {2}pgdata: \{\}\n {2}storagedata: \{\}/);
  });

  it("publishes only the slot's ports, on loopback", () => {
    expect(yaml).toContain('"127.0.0.1:24030:5432"');
    expect(yaml).toContain('"127.0.0.1:24031:9000"');
    expect(yaml).not.toMatch(/"(5435|9000):/);
  });
});

describe("renderViteConfig", () => {
  it("points the dev server and the /v1 proxy at the slot", () => {
    const config = renderViteConfig("/repo/apps/web/vite.config.ts", "/repo/apps/web", "/repo/.verify/slots/3/vite-cache", slotPorts(3));
    expect(config).toContain("port: 24033");
    expect(config).toContain('"/v1": "http://127.0.0.1:24032"');
    expect(config).toContain("strictPort: true");
    expect(config).not.toContain("3001");
  });
});
