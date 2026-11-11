import fs from "node:fs";
import { parseArgs } from "node:util";
import { createTableAdapter } from "../server/tables.js";
import { captureDirectory, createFixtureBundle, importBundle, makeBundle, readBundle, restoreDirectory,
  verifyDataset, verifyIdentity, writeBundle } from "../server/snapshots.js";

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    source: { type: "string" }, output: { type: "string" }, bundle: { type: "string" },
    dataset: { type: "string" }, "expected-profiles": { type: "string" },
    identity: { type: "string", default: "file" }, "normalize-missing": { type: "boolean", default: false }
  } });
  const [command] = positionals;
  const requireOption = (name) => {
    if (!values[name]) throw new Error(`Missing --${name}.`);
    return values[name];
  };
  const input = () => JSON.parse(fs.readFileSync(requireOption("bundle"), "utf8"));
  if (positionals.length !== 1) throw new Error("Specify one persistence command.");
  if (command === "fixture") {
    const bundle = createFixtureBundle();
    restoreDirectory(requireOption("output"), bundle);
    console.log(JSON.stringify({ ok: true, profiles: bundle.profiles, files: bundle.files.length, fixtureOnly: true }));
  } else if (command === "pack") {
    const expected = requireOption("expected-profiles");
    if (!/^\d+$/.test(expected)) throw new Error("Expected profiles must be an explicit nonnegative integer.");
    const bundle = captureDirectory(requireOption("source"), { expectedProfiles: Number(expected),
      identitySource: values.identity, normalizeMissing: values["normalize-missing"] });
    writeBundle(requireOption("output"), bundle);
    console.log(JSON.stringify({ ok: true, profiles: bundle.profiles, files: bundle.files.length }));
  } else if (command === "restore-local") {
    const bundle = input();
    restoreDirectory(requireOption("output"), bundle);
    console.log(JSON.stringify({ ok: true, profiles: bundle.profiles, files: bundle.files.length }));
  } else if (["import", "verify", "export"].includes(command)) {
    const adapter = await createTableAdapter(process.env, { tooling: true });
    if (command === "import") {
      const bundle = input();
      verifyIdentity(bundle.identity, readBundle(bundle));
      console.log(JSON.stringify({ ok: true, ...await importBundle(adapter, bundle) }));
    } else {
      const dataset = values.dataset || (command === "verify" && values.bundle ? undefined : requireOption("dataset"));
      const state = await verifyDataset(adapter, dataset, values.bundle ? input() : null);
      verifyIdentity(state.root.identity, state.files);
      if (command === "export") writeBundle(requireOption("output"), makeBundle(state.files, state.root.identity));
      console.log(JSON.stringify({ ok: true, dataset: state.dataset,
        profiles: Object.keys(JSON.parse(state.files.get("players.json"))).length, revision: state.root.revision }));
    }
  } else throw new Error("Use fixture, pack, restore-local, import, verify or export.");
} catch (error) {
  // SDK errors can include endpoints, headers and request bodies. Never print them.
  console.error("Persistence command failed. No success is confirmed.", error.code || error.name);
  process.exitCode = 1;
}
