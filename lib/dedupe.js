'use strict';

const sheets = require('./sheets');

function norm(s) {
  return (s || '').toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
}
function normPhone(s) {
  return (s || '').replace(/\D/g, '');
}

// Returns { type: 'none'|'exact'|'partial', matches: [member, ...] }
// Exact = first+last+email+phone all match. Partial = 2+ fields match but not all.
// Pass excludeMemberID to skip a specific row (e.g. the contact being upgraded).
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
    const emailHit = em && mEm && em === mEm;
    const phoneHit = ph && mPh && ph === mPh;
    const score = (nameHit ? 2 : 0) + (emailHit ? 1 : 0) + (phoneHit ? 1 : 0);
    if (score === 0) continue;

    hits.push({ member: m, exact: nameHit && emailHit && phoneHit, score });
  }

  if (!hits.length) return { type: 'none', matches: [] };

  const exactHits = hits.filter(h => h.exact);
  if (exactHits.length) {
    return { type: 'exact', matches: exactHits.map(h => h.member) };
  }

  const sorted = hits.sort((a, b) => b.score - a.score).map(h => h.member);
  return { type: 'partial', matches: sorted };
}

module.exports = { checkDupe };
