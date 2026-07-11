// Convert a stored SA phone number to E.164 for SMS providers.
// "0712345678" -> "+27712345678"; already-international numbers pass through.
function toE164ZA(phone) {
  const p = String(phone || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+')) return p;
  if (/^0\d{9}$/.test(p)) return '+27' + p.slice(1);
  if (/^27\d{9}$/.test(p)) return '+' + p;
  return '+' + p;
}

module.exports = { toE164ZA };
