'use strict';

const sheets = require('./sheets');
const { isPlaceholder } = require('./placeholder-email');

function norm(s) {
  return (s || '').toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
}
function normPhone(s) {
  return (s || '').replace(/\D/g, '');
}

// Email is the identity key. Records with different emails are different
// identities by design — same name/phone with a different email is NOT a
// duplicate and generates no warning.
//
// Exact duplicate = First + Last + Email + Phone all match. Only this
// triggers the "link or create new" stop-and-ask on creation paths.
//
// Returns { type: 'none'|'exact', matches: [member, ...] }
// Pass excludeMemberID to skip a specific row (e.g. the record being upgraded).
async function checkDupe(firstName, lastName, email, phone, excludeMemberID) {
  const members = await sheets.getMembers();
  const fn = norm(firstName), ln = norm(lastName);
  const em = norm(email),     ph = normPhone(phone);

  const hits = [];
  for (const m of members) {
    if (excludeMemberID && m.MemberID === excludeMemberID) continue;
    const mFn = norm(m.FirstName), mLn = norm(m.LastName);
    const mEm = norm(m.Email),     mPh = normPhone(m.Phone);

    const nameHit  = fn && ln && mFn && mLn && fn === mFn && ln === mLn;
    const emailHit = em && mEm && em === mEm && !isPlaceholder(em);
    const phoneHit = ph && mPh && ph === mPh;

    if (nameHit && emailHit && phoneHit) hits.push(m);
  }

  if (!hits.length) return { type: 'none', matches: [] };
  return { type: 'exact', matches: hits };
}

module.exports = { checkDupe };
