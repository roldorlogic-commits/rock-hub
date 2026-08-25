'use strict';

// Emails that are not real identities. Two contacts sharing one of these
// addresses are DIFFERENT people — never merge, dedupe, or collapse them.
// Add entries here to extend the list; the rest of the app imports isPlaceholder.
const PLACEHOLDER_EMAILS = new Set([
  'noemail@gorock.org',
]);

function isPlaceholder(email) {
  if (!email) return true;
  const norm = email.trim().toLowerCase();
  if (!norm) return true;
  return PLACEHOLDER_EMAILS.has(norm);
}

module.exports = { isPlaceholder };
