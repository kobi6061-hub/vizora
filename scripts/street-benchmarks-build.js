#!/usr/bin/env node
// PROPX · writes data/streets/benchmarks.json — the locality and district comparison figures of the street report
// (lib/streets/benchmarks.js), from the register sweep stored now. Offline; deterministic apart from builtAt.

'use strict';

const fs = require('node:fs');
const B = require('../lib/streets/benchmarks');

const doc = B.build();
fs.writeFileSync(B.FILE, JSON.stringify(doc));
console.log(JSON.stringify({ file: B.FILE, localities: Object.keys(doc.localities).length, districts: Object.keys(doc.districts).length, evidence: doc.evidence }));
