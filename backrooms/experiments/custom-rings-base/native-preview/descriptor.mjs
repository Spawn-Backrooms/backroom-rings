import { buildDescriptor } from "./contract.mjs";

process.stdout.write(`${JSON.stringify(buildDescriptor(), null, 2)}\n`);
