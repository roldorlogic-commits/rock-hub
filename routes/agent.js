'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();
const ai      = require('../lib/ai');
const sheets  = require('../lib/sheets');
const email   = require('../lib/email');
const sms     = require('../lib/sms');
const pdf     = require('../lib/pdf');
const { requireBoard } = require('../middleware/auth');

router.use(requireBoard);

// ── Usage logging ─────────────────────────────────────────────────────────────

const USAGE_LOG = path.join(__dirname, '../config/agent-usage.log');

function logUsage(userEmail, inputTokens, outputTokens, model) {
  const line = `${new Date().toISOString()}\t${userEmail}\t${model}\t${inputTokens}\t${outputTokens}\n`;
  try { fs.appendFileSync(USAGE_LOG, line); } catch (_) {}
}

// ── Rate limiting ─────────────────────────────────────────────────────────────

const rateLimits = new Map();
const RATE_LIMIT  = 30;
const RATE_WINDOW = 5 * 60 * 1000;

function checkRateLimit(email_) {
  const now = Date.now();
  let rl = rateLimits.get(email_);
  if (!rl || now > rl.resetAt) {
    rl = { count: 0, resetAt: now + RATE_WINDOW };
    rateLimits.set(email_, rl);
  }
  if (rl.count >= RATE_LIMIT) return false;
  rl.count++;
  return true;
}

// ── Hub data loader ───────────────────────────────────────────────────────────

async function loadHubContext() {
  const comms = require('../lib/comms');
  const [members, events, volunteers, tasks, youthGroups, announcements, templates, optOuts] = await Promise.all([
    sheets.getMembers(),
    sheets.getEvents(),
    sheets.getVolunteers(),
    sheets.getTasks(),
    sheets.getYouthGroups(),
    sheets.getAnnouncements().catch(() => []),
    comms.getTemplates().catch(() => []),
    comms.getOptOuts().catch(() => []),
  ]);

  const now = new Date();

  const membersSummary = members.map(m => ({
    id:   m.MemberID,
    name: [m.FirstName, m.LastName].filter(Boolean).join(' ') || m.Email,
    email: m.Email || null,
    phone: m.Phone || null,
    tags:  m.Tags  || null,
    type:  m.MembershipType || null,
    status: m.MembershipStatus || 'Active',
  }));

  const eventsSummary = events.map(e => ({
    id:          e.EventID,
    name:        e.EventName,
    start:       e.StartDate,
    end:         e.EndDate,
    status:      e.Status,
    location:    e.Location || null,
    address:     e.Address  || null,
    coordinator: e.Coordinator || null,
    capacity:    e.MaxCapacity || null,
    description: e.Description || null,
  }));

  const volunteersSummary = volunteers.map(v => ({
    id:        v.VolunteerID,
    name:      [v.FirstName, v.LastName].filter(Boolean).join(' ') || v.Email,
    email:     v.Email || null,
    phone:     v.Phone || null,
    role:      v.PreferredRole || null,
    status:    v.Status,
    hours:     v.HoursLogged || 0,
  }));

  const tasksSummary = tasks.map(t => ({
    id:       t.TaskID,
    title:    t.Title,
    assignee: t.AssignedTo || t.AssigneeName || null,
    due:      t.DueDate    || null,
    priority: t.Priority   || null,
    status:   t.Status     || 'Pending',
  }));

  const ygSummary = youthGroups.map(g => ({
    id:       g.id,
    name:     g.youth_group_name,
    church:   g.church_name    || null,
    category: g.category       || null,
    city:     g.city           || null,
    state:    g.state          || null,
    contact:  g.primary_contact_name  || null,
    phone:    g.primary_contact_phone || null,
    email:    g.primary_contact_email || null,
  }));

  const annSummary = announcements.slice(-10).map(a => ({
    subject: a.Subject,
    body:    a.Body,
    date:    a.SentAt || null,
  }));

  const optedOutPhones = new Set(optOuts.filter(r => r.Status === 'opted-out').map(r => r.Phone));

  const templatesSummary = templates.map(t => ({
    id:      t.TemplateID,
    name:    t.Name,
    channel: t.Channel,
    subject: t.Subject || null,
    body:    t.Body,
  }));

  return {
    asOf:          now.toISOString(),
    members:       membersSummary,
    events:        eventsSummary,
    volunteers:    volunteersSummary,
    tasks:         tasksSummary,
    youthGroups:   ygSummary,
    announcements: annSummary,
    templates:     templatesSummary,
    optedOutPhones: [...optedOutPhones],
  };
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(ctx, user) {
  return `You are the ROCK Hub AI Assistant — the internal AI for The ROCK Association board (Recruiters of Christ's Kingdom).
You are talking to ${user.name || user.email}, a board member.

TODAY: ${new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}

## YOUR CAPABILITIES

1. ANSWER QUESTIONS — grounded in live Hub data provided below. Never fabricate names, numbers, or dates. If you don't know something from the data, say so.

2. PRE-FILL FORMS — call prefill_form() with extracted field values. The user reviews and SUBMITS — you never auto-submit.

3. DRAFT DOCUMENTS — call draft_document() with a title and clean HTML content for letters, reports, summaries. Use <h2>, <p>, <ul>, <li>, <strong> only.

4. COMPOSE MESSAGES — call compose_message() to draft an email or SMS. It ALWAYS goes through a confirm-before-send gate. You never send on your own initiative. For group sends, include every resolved recipient.
   - Templates are listed in Hub data under "templates" — you may reference them by name and use their body as a starting point.
   - NEVER include opted-out phone numbers (listed in optedOutPhones) as SMS recipients.

## GUARDRAILS
- Resolve all names/emails/phones from the Hub data below — never guess.
- Never auto-submit forms, create/edit/delete records, or perform unsolicited sends.
- Sensitive data (emails, phones) may be used — this is a paid, private deployment.
- SMS: automatically exclude any number in the optedOutPhones list from recipient lists.

## LIVE HUB DATA
\`\`\`json
${JSON.stringify(ctx, null, 1)}
\`\`\``;
}

// ── Gemini function declarations ──────────────────────────────────────────────

const TOOLS = [
  {
    name: 'prefill_form',
    description: 'Pre-fill a Hub form with field values extracted from the request. The user reviews and submits — never auto-submits.',
    parameters: {
      type: 'OBJECT',
      properties: {
        form: {
          type: 'STRING',
          enum: ['event', 'contact', 'volunteer', 'task', 'youth_group'],
          description: 'Which form to open and pre-fill.',
        },
        fields: {
          type: 'OBJECT',
          description: 'Key-value pairs matching the form field IDs or semantic names.',
        },
        summary: {
          type: 'STRING',
          description: 'One-sentence summary to show the user about what was pre-filled.',
        },
      },
      required: ['form', 'fields'],
    },
  },
  {
    name: 'draft_document',
    description: 'Draft a letter, report, email, or other document for the user to review, edit, and optionally export as PDF.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title:   { type: 'STRING', description: 'Document title.' },
        content: { type: 'STRING', description: 'Document body as clean HTML using only h2, p, ul, li, strong, em tags.' },
        summary: { type: 'STRING', description: 'One-sentence description of the draft.' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'compose_message',
    description: 'Compose an email or SMS for the user to review via the confirm gate before any send. Always resolve recipient names and contact info from Hub data.',
    parameters: {
      type: 'OBJECT',
      properties: {
        channel: { type: 'STRING', enum: ['email', 'sms'], description: 'email or sms.' },
        recipients: {
          type: 'ARRAY',
          description: 'All resolved recipients. Must list every person explicitly — no vague groups.',
          items: {
            type: 'OBJECT',
            properties: {
              name: { type: 'STRING' },
              to:   { type: 'STRING', description: 'Email address (email channel) or phone number (sms channel) resolved from Hub data.' },
            },
            required: ['name', 'to'],
          },
        },
        subject: { type: 'STRING', description: 'Required for email channel.' },
        body:    { type: 'STRING', description: 'Full message text.' },
        summary: { type: 'STRING', description: 'One-sentence description shown to user.' },
      },
      required: ['channel', 'recipients', 'body'],
    },
  },
];

// ── Status endpoint ───────────────────────────────────────────────────────────

router.get('/status', (req, res) => {
  res.json({ configured: ai.isConfigured(), model: ai.MODEL });
});

// ── History endpoint ──────────────────────────────────────────────────────────

router.get('/history', async (req, res) => {
  const userEmail = req.user?.email || 'unknown';
  try {
    const messages = await sheets.getAgentHistory(userEmail);
    res.json({ messages });
  } catch (err) {
    console.error('[agent] history load error:', err.message);
    res.json({ messages: [] });
  }
});

// ── Main chat endpoint ────────────────────────────────────────────────────────

router.post('/chat', async (req, res) => {
  const userEmail = req.user?.email || 'unknown';
  if (!checkRateLimit(userEmail)) {
    return res.status(429).json({ error: 'Too many requests — please wait a moment.' });
  }
  if (!ai.isConfigured()) {
    return res.status(503).json({ error: 'Agent not configured — GEMINI_API_KEY is not set.' });
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages[] is required.' });
  }

  try {
    const ctx    = await loadHubContext();
    const prompt = buildSystemPrompt(ctx, req.user);
    const result = await ai.chat({ messages, systemInstruction: prompt, tools: TOOLS });

    logUsage(userEmail, result.usage.promptTokenCount || 0, result.usage.candidatesTokenCount || 0, ai.MODEL);

    let replyText;
    let responsePayload;
    if (result.functionCall) {
      const { name, args } = result.functionCall;
      replyText      = args.summary || `I'll ${name.replace(/_/g, ' ')} now.`;
      responsePayload = { reply: replyText, action: { type: name, payload: args } };
    } else {
      replyText      = result.text;
      responsePayload = { reply: replyText };
    }

    // Persist history (fire-and-forget) — appends the model reply to incoming messages
    const modelMsg = { role: 'model', parts: [{ text: replyText || '[action]' }] };
    sheets.saveAgentHistory(userEmail, [...messages, modelMsg]).catch(() => {});

    res.json(responsePayload);
  } catch (err) {
    console.error('[agent] chat error:', err.message);
    if (err.code === 429) return res.status(429).json({ error: 'AI quota exceeded — try again shortly.' });
    if (err.code === 503)  return res.status(503).json({ error: err.message });
    res.status(500).json({ error: 'AI error: ' + err.message });
  }
});

// ── Send endpoint (confirm-gate action) ──────────────────────────────────────

router.post('/send', async (req, res) => {
  const { channel, recipients, subject, body: msgBody } = req.body || {};
  if (!channel || !Array.isArray(recipients) || !recipients.length || !msgBody) {
    return res.status(400).json({ error: 'channel, recipients[], and body are required.' });
  }

  const results = [];
  for (const r of recipients) {
    const entry = { name: r.name, to: r.to };
    if (channel === 'email') {
      if (!r.to || !r.to.includes('@')) {
        entry.result = { sent: false, error: 'Invalid email address' };
      } else {
        entry.result = await email.send(r.to, subject || 'Message from ROCK Hub', msgBody, null, {});
      }
    } else if (channel === 'sms') {
      entry.result = await sms.send(r.to, msgBody); // branding + opt-out check applied inside sms.send()
    } else {
      entry.result = { sent: false, error: 'Unknown channel' };
    }
    results.push(entry);
  }

  const sent        = results.filter(r => r.result?.sent).length;
  const skippedOpts = results.filter(r => r.result?.skippedOptOut).length;
  const failed      = results.filter(r => !r.result?.sent && !r.result?.skippedOptOut);
  res.json({ ok: true, sent, total: recipients.length, skippedOptOut: skippedOpts, results, failed: failed.map(f => ({ name: f.name, error: f.result?.error })) });
});

// ── Draft PDF endpoint ────────────────────────────────────────────────────────

router.post('/draft-pdf', async (req, res) => {
  const { title, content } = req.body || {};
  if (!title || !content) return res.status(400).json({ error: 'title and content are required.' });
  try {
    const buf = await pdf.generateLetterheadPdf(title, content);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(title)}.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error('[agent] pdf error:', err.message);
    res.status(500).json({ error: 'PDF generation failed: ' + err.message });
  }
});

module.exports = router;
