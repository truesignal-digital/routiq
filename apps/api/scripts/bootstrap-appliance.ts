/**
 * Bootstrap appliance with test workspace for cold-start validation.
 * Used only when BOOTSTRAP_ADMIN_PIN is set (nightly test, CI, dev).
 * 
 * Creates:
 * - Operator principal (vendor-cli)
 * - Test workspace (test-appliance)
 * - Admin user (admin)
 * 
 * Idempotent: subsequent runs skip if workspace already exists.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { authDb, db } from "../src/db/client.js";
import { principals, workspaces } from "../src/db/schema.js";
import { resolveOperatorContext } from "../src/auth/context.js";
import { platformDb } from "../src/db/platform.js";
import { dispatchCommand } from "../src/commands/dispatcher.js";
import "../src/server.js";
import { eq } from "drizzle-orm";

const adminPin = process.env["BOOTSTRAP_ADMIN_PIN"];
if (!adminPin) {
  console.log("BOOTSTRAP_ADMIN_PIN not set, skipping bootstrap");
  process.exit(0);
}

try {
  // Check if workspace already exists
  const existing = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, "test-appliance"));
  
  if (existing.length > 0) {
    console.log("Bootstrap workspace already exists, skipping");
    process.exit(0);
  }

  // Create operator principal
  const [operator] = await authDb
    .insert(principals)
    .values({ principalType: "VENDOR_OPERATOR", displayName: "bootstrap-operator" })
    .returning();
  
  if (!operator) throw new Error("Failed to create operator principal");

  const operatorCtx = await resolveOperatorContext(authDb, operator.id);
  if (!operatorCtx) throw new Error("Failed to resolve operator context");

  // Provision test workspace
  const platform = platformDb(db);
  const result = await dispatchCommand(platform, operatorCtx, {
    name: "provision-workspace",
    version: 2,
    envelope: {
      commandId: randomUUID(),
      idempotencyKey: `bootstrap-${Date.now()}`,
      origin: "BOOTSTRAP",
    },
    payload: {
      workspace: {
        id: randomUUID(),
        slug: "test-appliance",
        name: "Test Appliance",
      },
      branches: [
        {
          id: randomUUID(),
          code: "TEST",
          name: "Test Branch",
        },
      ],
      admin: {
        id: randomUUID(),
        displayName: "Admin User",
        username: "admin",
        pin: adminPin,
      },
      enabledPresets: ["TRUCKING"],
    },
  });

  if (result.status !== 200) {
    console.error("Provisioning failed:", result);
    process.exit(1);
  }

  console.log("Bootstrap complete: workspace test-appliance provisioned");
  process.exit(0);
} catch (error) {
  console.error("Bootstrap error:", error);
  process.exit(1);
}
