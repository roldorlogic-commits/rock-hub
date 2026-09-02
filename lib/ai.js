'use strict';

// Gemini AI provider abstraction.
// Uses the Gemini REST API directly (no SDK dependency).
// Model is configurable via GEMINI_MODEL env var; defaults to gemini-flash-latest.
// Swap provider later by replacing this module.

const https = require('https');

const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

function isConfigured() {
  return !!process.env.GEMINI_API_KEY;
}

async function geminiPost(path, body) {
  const key  = process.env.GEMINI_API_KEY;
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/${path}?key=${encodeURIComponent(key)}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      }
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) {
            const code = parsed.error.code;
            const msg  = parsed.error.message || 'Gemini API error';
            if (code === 429) {
              reject(Object.assign(new Error('QUOTA_EXCEEDED'), { code: 429 }));
            } else {
              reject(Object.assign(new Error(msg), { code }));
            }
          } else {
            resolve(parsed);
          }
        } catch (_) { reject(new Error('Invalid Gemini response')); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// messages: [{role:'user'|'model', parts:[{text}]}]
// systemInstruction: string
// tools: array of Gemini function_declarations
// Returns { text, functionCall?, usage }
async function chat({ messages, systemInstruction, tools }) {
  if (!isConfigured()) throw Object.assign(new Error('GEMINI_NOT_CONFIGURED'), { code: 503 });

  const body = {
    contents: messages,
    ...(systemInstruction
      ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
      : {}),
    ...(tools?.length
      ? { tools: [{ function_declarations: tools }] }
      : {}),
    generationConfig: {
      temperature:      0.3,
      maxOutputTokens:  4096,
    },
  };

  const result    = await geminiPost(`models/${MODEL}:generateContent`, body);
  const candidate = result.candidates?.[0];
  const content   = candidate?.content;
  const usage     = result.usageMetadata || {};

  const fnPart   = content?.parts?.find(p => p.functionCall);
  if (fnPart) return { text: null, functionCall: fnPart.functionCall, usage };

  const textPart = content?.parts?.find(p => p.text);
  return { text: textPart?.text ?? '', functionCall: null, usage };
}

module.exports = { chat, isConfigured, MODEL };
