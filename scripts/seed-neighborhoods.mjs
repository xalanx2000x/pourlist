/**
 * Seed script: nyc-neighborhoods.geojson → neighborhood_zones table.
 * Calls upsert_neighborhood_zone() for each feature — safe to re-run (upsert).
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=*** \
 *   node scripts/seed-neighborhoods.mjs
 */

import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const GEOJSON_PATH = new URL("../data/nyc-neighborhoods.geojson", import.meta.url);
const CITY = "New York";
const STATE = "NY";

async function main() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error("❌  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const geojson = JSON.parse(readFileSync(GEOJSON_PATH, "utf8"));
  const features = geojson.features;

  console.log(`📍  Seeding ${features.length} neighborhoods for ${CITY}, ${STATE}\n`);

  let ok = 0;
  let err = 0;

  for (const feature of features) {
    const name = feature.properties?.name;
    if (!name || !feature.geometry) {
      console.warn("⚠️  Skipping feature with missing name or geometry");
      err++;
      continue;
    }

    const { data, error } = await supabase.rpc("upsert_neighborhood_zone", {
      p_city: CITY,
      p_state: STATE,
      p_display_name: name,
      p_geometry: feature.geometry,
      p_is_active: true,
    });

    if (error) {
      console.error(`❌  ${name}: ${error.message}`);
      err++;
    } else {
      console.log(`✅  ${name} → ${data}`);
      ok++;
    }
  }

  console.log(`\n${ok} inserted/updated, ${err} failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
