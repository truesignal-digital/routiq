import "dotenv/config";
import { authPool, pool } from "../src/db/client.js";
import { deterministicProvisionId, provisionTenant } from "./provision.js";

const workspaceId = deterministicProvisionId("workspace:sotrafret");
const branchId = deterministicProvisionId("branch:sotrafret:DLA");
const adminId = deterministicProvisionId("admin:sotrafret:amina");

try {
  const result = await provisionTenant({
    workspace: {
      id: workspaceId,
      slug: "sotrafret",
      name: "SotraFret Douala",
    },
    branches: [
      {
        id: branchId,
        code: "DLA",
        name: "Douala",
      },
    ],
    admin: {
      id: adminId,
      displayName: "Amina Njoya",
      username: "amina",
      pin: "246810",
    },
    enabledPresets: ["TRUCKING"],
  });

  console.log(
    `Seed complete: workspace=${result.workspaceSlug} (${result.workspaceId}) branches=${result.branchCodes.join(", ")}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await Promise.all([pool.end(), authPool.end()]);
}
