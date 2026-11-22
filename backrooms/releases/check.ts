import { readFile } from 'node:fs/promises';
import { assertProductionEligible, productionBlockers } from '../client/release.js';

const path = process.argv[2];
const approvedDigest = process.env.BACKROOMS_APPROVED_MANIFEST_SHA256;
if (!path || !approvedDigest) {
  console.error('Pass the generated manifest path and set BACKROOMS_APPROVED_MANIFEST_SHA256 from the operator-approved release configuration.');
  process.exitCode = 1;
} else {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    const blockers = productionBlockers(value);
    if (blockers.length > 0) {
      console.error(JSON.stringify({ eligible: false, blockers }));
      process.exitCode = 1;
    } else {
      await assertProductionEligible(value, approvedDigest);
      console.log(JSON.stringify({ eligible: true, approvedManifestSha256: approvedDigest }));
    }
  } catch {
    console.error(JSON.stringify({ eligible: false, blockers: ['invalid_or_unapproved_manifest'] }));
    process.exitCode = 1;
  }
}
