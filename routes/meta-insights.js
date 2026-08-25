'use strict';

const express = require('express');
const router  = express.Router();
const { requireBoard } = require('../middleware/auth');

router.use(requireBoard);

// 45-minute in-memory cache keyed by "insights_{days}"
const CACHE_TTL = 45 * 60 * 1000;
const _cache = {};
function getCached(key) {
  const c = _cache[key];
  return (c && Date.now() - c.ts < CACHE_TTL) ? c.data : null;
}
function putCache(key, data) { _cache[key] = { ts: Date.now(), data }; }

function unixDaysAgo(n) {
  return Math.floor((Date.now() - n * 86400000) / 1000);
}

async function graphGet(path, params, token) {
  const url = new URL(`https://graph.facebook.com/v19.0${path}`);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const r = await fetch(url.toString(), { signal: AbortSignal.timeout(12000) });
  return r.json();
}

// Sum all daily values for a named metric in an insights data array.
function sumMetric(data, name) {
  const m = data.find(d => d.name === name);
  if (!m?.values?.length) return null;
  return m.values.reduce((s, v) => s + (Number(v.value) || 0), 0);
}

// Growth = last snapshot minus first snapshot (for cumulative series like fan count).
function growthMetric(data, name) {
  const m = data.find(d => d.name === name);
  if (!m?.values?.length) return null;
  const first = Number(m.values[0]?.value);
  const last  = Number(m.values[m.values.length - 1]?.value);
  return (!isNaN(first) && !isNaN(last)) ? last - first : null;
}

// GET /api/meta/insights?period=7|30
router.get('/insights', async (req, res) => {
  const days     = parseInt(req.query.period) === 30 ? 30 : 7;
  const cacheKey = `insights_${days}`;
  const cached   = getCached(cacheKey);
  if (cached) return res.json({ ...cached, fromCache: true });

  const fbToken = process.env.META_ACCESS_TOKEN;
  const pageId  = process.env.META_PAGE_ID;
  const igBizId = process.env.META_IG_BUSINESS_ID;

  if (!fbToken || !pageId) {
    return res.json({ configured: false, reason: 'META_ACCESS_TOKEN and META_PAGE_ID env vars required' });
  }

  const since = unixDaysAgo(days);
  const until = Math.floor(Date.now() / 1000);

  // ── Facebook ──────────────────────────────────────────────────────────────
  const fb = { ok: false };
  try {
    const pageData = await graphGet(`/${pageId}`, { fields: 'fan_count,name' }, fbToken);
    if (pageData.error) {
      fb.error = { code: pageData.error.code, message: pageData.error.message, type: pageData.error.type };
    } else {
      fb.ok        = true;
      fb.name      = pageData.name;
      fb.followers = pageData.fan_count ?? null;
    }

    // Insights: requires read_insights + pages_read_engagement
    const fbInsightData = await graphGet(`/${pageId}/insights`, {
      metric: 'page_impressions,page_impressions_unique,page_engaged_users,page_views_total,page_fans,page_fan_adds',
      period: 'day',
      since,
      until
    }, fbToken);

    if (fbInsightData.error) {
      fb.insightsError = { code: fbInsightData.error.code, message: fbInsightData.error.message };
      if ([10, 200, 190].includes(fbInsightData.error.code)) fb.missingScopes = true;
    } else if (fbInsightData.data) {
      const d          = fbInsightData.data;
      fb.impressions   = sumMetric(d, 'page_impressions');
      fb.reach         = sumMetric(d, 'page_impressions_unique');
      fb.engagement    = sumMetric(d, 'page_engaged_users');
      fb.pageViews     = sumMetric(d, 'page_views_total');
      fb.fanAdds       = sumMetric(d, 'page_fan_adds');
      fb.followersGrowth = growthMetric(d, 'page_fans');
    }
  } catch (err) {
    fb.fetchError = err.message;
  }

  // ── Instagram (via Facebook Graph API — requires META_IG_BUSINESS_ID) ──────
  const ig = { ok: false };
  if (!igBizId) {
    ig.notConfigured = true;
  } else {
    try {
      const acctData = await graphGet(`/${igBizId}`, { fields: 'followers_count,username,name' }, fbToken);
      if (acctData.error) {
        ig.error = { code: acctData.error.code, message: acctData.error.message };
      } else {
        ig.ok        = true;
        ig.username  = acctData.username;
        ig.followers = acctData.followers_count ?? null;
      }

      // Insights: requires instagram_manage_insights + instagram_basic
      const igInsightData = await graphGet(`/${igBizId}/insights`, {
        metric: 'reach,impressions,profile_views,follower_count',
        period: 'day',
        since,
        until
      }, fbToken);

      if (igInsightData.error) {
        ig.insightsError = { code: igInsightData.error.code, message: igInsightData.error.message };
        if ([10, 200, 190].includes(igInsightData.error.code)) ig.missingScopes = true;
      } else if (igInsightData.data) {
        const d          = igInsightData.data;
        ig.reach         = sumMetric(d, 'reach');
        ig.impressions   = sumMetric(d, 'impressions');
        ig.profileViews  = sumMetric(d, 'profile_views');
        ig.followersGrowth = growthMetric(d, 'follower_count');
      }
    } catch (err) {
      ig.fetchError = err.message;
    }
  }

  const result = { configured: true, period: days, fb, ig };
  putCache(cacheKey, result);
  res.json(result);
});

module.exports = router;
