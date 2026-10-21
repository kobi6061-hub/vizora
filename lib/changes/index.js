// PROPX · What Changed Here? — server read model (scaffold; the change-feed workstream replaces this file).
// GET /api/intel?view=changes… → view(name, params) → { status, body }.
'use strict';

function view(name) {
  return { status: 501, body: { error: 'not-built', view: name } };
}

module.exports = { view };
