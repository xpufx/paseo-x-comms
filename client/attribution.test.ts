import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { XCOMMS_VIA_LABEL } from "./attribution.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const readSource = (file: string) => readFileSync(join(HERE, file), "utf8");

/**
 * Standing attribution rule: every shared-surface contribution point must
 * render the plugin source label. Headless here, so this test audits the
 * contribution sources directly: each must reference the shared ViaXComms
 * footer. Add new contribution points to LABELED_FILES when they appear.
 */
const LABELED_FILES = [
  "x-comms-timeline.tsx",
  "x-comms-tool-call.tsx",
  "x-comms-conversation.tsx",
  "main.tsx",
];

describe("attribution rule", () => {
  it("label text is the canonical plugin tag", () => {
    assert.equal(XCOMMS_VIA_LABEL, "via x-comms");
  });

  it("every contribution point renders the shared footer", () => {
    for (const file of LABELED_FILES) {
      const source = readSource(file);
      assert.match(source, /ViaXComms/, `${file} must render the ViaXComms footer`);
      assert.match(source, /from "\.\/via-x-comms"/, `${file} must use the shared attribution module`);
    }
  });

  it("the footer component renders the canonical label", () => {
    const source = readSource("via-x-comms.tsx");
    assert.match(source, /XCOMMS_VIA_LABEL/, "via-x-comms.tsx must render the canonical label, not a copy");
  });
});
