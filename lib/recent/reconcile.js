// placeholder — replaced by the reconciliation engine in the same change set
'use strict';
const normCity = (s) => String(s || '').replace(/["'״׳\s\-–]/g, '').replace(/וו/g, 'ו').replace(/יי/g, 'י');
module.exports = { normCity };
