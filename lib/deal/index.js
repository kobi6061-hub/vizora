// PROPX · Deal Decision Lab — server read model (scaffold; the Deal Lab workstream replaces this file).
// GET /api/intel?view=deal… → view(name, params) → { status, body }.
'use strict';

function view(name) {
  return { status: 501, body: { error: 'not-built', view: name } };
}

module.exports = { view };
