import { plugin } from "bun";
import { readFile } from "node:fs/promises";
import { transform } from "./patch.mjs";

// Candidate qualification only: no installed file is written and no server is opened.
plugin({
  name: "piomo-hydrogen-tool-catalog-candidate",
  setup(build) {
    build.onLoad({ filter: /[/\\]opencodex[/\\]src[/\\]adapters[/\\]google\.ts$/ }, async ({ path }) => ({
      contents: transform(await readFile(path, "utf8")),
      loader: "ts",
    }));
  },
});
