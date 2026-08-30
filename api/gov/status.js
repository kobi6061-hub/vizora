// GET /api/gov/status — government data layer health: which providers are
// registered, what each can serve, and whether the authorized Tax Authority
// connector is active. Session-gated by the site middleware like every page.

'use strict';

const { getService } = require('./_service');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end('Method Not Allowed');
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.end(JSON.stringify({ providers: getService().status(), at: new Date().toISOString() }));
};
