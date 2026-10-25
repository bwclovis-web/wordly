import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { changePackageJsonSchema } from "../src/changePackage/jsonSchema";

const out = path.resolve(__dirname, "..", "docs", "schemas", "change-package.v1.schema.json");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(changePackageJsonSchema(), null, 2)}\n`, "utf8");
console.log(`Wrote ${path.relative(process.cwd(), out)}`);
