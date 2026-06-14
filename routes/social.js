'use strict';

const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { requireBoard } = require('../middleware/auth');

const PARTNERS_FILE = path.join(__dirname, '../config/partners.json');

function readPartners()         { return JSON.parse(fs.readFileSync(PARTNERS_FILE, 'utf8')); }
function writePartners(data)    { fs.writeFileSync(PARTNERS_FILE, JSON.stringify(data, null, 2)); }

router.use(requireBoard);
router.use(express.json());

// ── ROCK's own Facebook posts ─────────────────────────────────────────────────
router.get('/posts', async (req, res) => {
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_PAGE_ID) {
    return res.json({ data: [], configured: false });
  }
  try {
    const r = await fetch(
      `https://graph.facebook.com/v19.0/${process.env.META_PAGE_ID}/posts` +
      `?fields=message,created_time,full_picture,permalink_url` +
      `&access_token=${process.env.META_ACCESS_TOKEN}`
    );
    res.json({ ...(await r.json()), configured: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ROCK's own Instagram feed ─────────────────────────────────────────────────
router.get('/instagram', async (req, res) => {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) return res.json({ data: [], configured: false });
  try {
    const [mediaRes, meRes] = await Promise.all([
      fetch(`https://graph.instagram.com/me/media?fields=id,caption,media_type,media_url,thumbnail_url,timestamp,permalink&access_token=${token}`),
      fetch(`https://graph.instagram.com/me?fields=username&access_token=${token}`)
    ]);
    const mediaData = await mediaRes.json();
    const meData    = await meRes.json().catch(() => ({}));
    res.json({ ...mediaData, username: meData.username, configured: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Partner orgs: list ────────────────────────────────────────────────────────
router.get('/partners', (req, res) => {
  res.json(readPartners());
});

// ── Partner orgs: add a post URL to a partner ─────────────────────────────────
// POST /social/partners/:id/posts   { "url": "https://www.instagram.com/p/..." }
router.post('/partners/:id/posts', (req, res) => {
  const { url } = req.body;
  if (!url || !/instagram\.com\/(p|reel|tv)\//.test(url)) {
    return res.status(400).json({ error: 'Provide a valid Instagram post, reel, or TV URL.' });
  }

  const partners = readPartners();
  const partner  = partners.find(p => p.id === req.params.id);
  if (!partner) return res.status(404).json({ error: 'Partner not found.' });

  // Normalise URL: strip query strings and trailing fragments
  const clean = url.split('?')[0].split('#')[0].replace(/\/?$/, '/');
  if (!partner.posts.includes(clean)) partner.posts.unshift(clean); // newest first
  writePartners(partners);
  res.json({ ok: true, partner });
});

// ── Partner orgs: remove a post URL from a partner ───────────────────────────
// DELETE /social/partners/:id/posts?url=...
router.delete('/partners/:id/posts', (req, res) => {
  const { url } = req.query;
  const partners = readPartners();
  const partner  = partners.find(p => p.id === req.params.id);
  if (!partner) return res.status(404).json({ error: 'Partner not found.' });

  partner.posts = partner.posts.filter(u => u !== url);
  writePartners(partners);
  res.json({ ok: true });
});

// ── oEmbed proxy ──────────────────────────────────────────────────────────────
// Instagram's oEmbed endpoint embeds a SPECIFIC known post URL.
// It does NOT discover latest posts from an account — a post URL must be provided.
// GET /social/oembed?url=https://www.instagram.com/p/SHORTCODE/
router.get('/oembed', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url parameter required.' });

  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) return res.status(503).json({ error: 'Instagram token not configured.' });

  try {
    const r = await fetch(
      `https://graph.facebook.com/v19.0/instagram_oembed` +
      `?url=${encodeURIComponent(url)}&access_token=${token}&maxwidth=400&omitscript=true`
    );
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
