// Emits one JSON Schema document holding every protocol type, for Python codegen.
import { writeFileSync } from "node:fs";
import { z } from "zod";
import * as p from "../dist/index.js";

const names = ["AgentConfig", "AvatarEvent", "CreateSessionRequest", "CreateSessionResponse"];
const defs = {};
for (const n of names) {
  const { $schema, ...schema } = z.toJSONSchema(p[n], { target: "draft-2020-12", io: "input" });
  defs[n] = schema;
}
const doc = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "MetaAvatarProtocol",
  type: "object",
  properties: Object.fromEntries(names.map((n) => [n, { $ref: `#/$defs/${n}` }])),
  $defs: defs,
};
writeFileSync(new URL("../schema/protocol.schema.json", import.meta.url), JSON.stringify(doc, null, 2) + "\n");
console.log("wrote schema/protocol.schema.json");
