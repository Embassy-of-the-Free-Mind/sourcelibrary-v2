#!/usr/bin/env node
// PRIOR ART: scripts/eval/lane-judge-sampler.mjs claudeMeter (this only prints it, for the job's spend log).
import * as limits from '../../lib/model-limits.mjs';
import { claudeMeter } from '../lane-judge-sampler.mjs';
console.log(JSON.stringify(await claudeMeter(limits)));
process.exit(0);
