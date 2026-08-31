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
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  // deployment identity, so a stale browser cache is instantly distinguishable
  // from a stale deployment
  res.end(JSON.stringify({
    providers: getService().status(),
    build: {
      commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      ref: process.env.VERCEL_GIT_COMMIT_REF || null,
      deployedAt: process.env.VERCEL_DEPLOYMENT_ID ? undefined : null,
      env: process.env.VERCEL_ENV || 'local',
    },
    at: new Date().toISOString(),
  }));
};
