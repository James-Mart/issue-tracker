import { expect, test } from "./fixtures";
import { gotoCockpitReady } from "./seed-navigation";

test("seeded cockpit shows top-level work roots only", async ({ page, seededApp }) => {
  await gotoCockpitReady(page, seededApp.baseURL);
});
