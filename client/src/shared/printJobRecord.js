// Court-ready work record: opens a printable page (print → save as PDF) with
// every server-recorded fact about a job — parties, agreed amount, negotiation
// history, GPS/time-stamped handshakes, proof photos, issues, payment and
// ratings. Written for use as supporting evidence in dispute resolution,
// e.g. the South African Small Claims Court (claims up to R20 000).

const API_URL = process.env.REACT_APP_API_URL || '';

function sast(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('en-ZA', {
      timeZone: 'Africa/Johannesburg',
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }) + ' SAST';
  } catch (e) { return String(d); }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function absUrl(u) {
  if (!u) return '';
  if (u.startsWith('http')) return u;
  return (API_URL || window.location.origin) + u;
}

function gps(loc) {
  if (!loc || loc.lat == null || loc.lng == null) return '—';
  return `${Number(loc.lat).toFixed(5)}, ${Number(loc.lng).toFixed(5)}`;
}

export default function printJobRecord(job) {
  if (!job) return;
  const poster = job.posterId || {};
  const acceptedApp = job.applications?.find(a =>
    a.status === 'accepted' || String(a._id || a.id) === String(job.acceptedApplicationId)
  ) || job.applications?.[0];
  const provider = acceptedApp?.applicantId || {};
  const agreed = acceptedApp?.approvedAmount || acceptedApp?.proposedAmount || job.budget;

  const negotiationRows = (acceptedApp?.negotiationHistory || []).map((h, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${sast(h.createdAt)}</td>
      <td>${esc(String(h.proposedBy) === String(poster._id || poster.id) ? (poster.name || 'Job provider') : (provider.name || 'Helper'))}</td>
      <td>R${esc(h.amount)}</td>
      <td>${esc(h.status || 'pending')}</td>
      <td>${esc(h.message || '')}</td>
    </tr>`).join('');

  const timeline = [
    ['Job posted', job.createdAt],
    ['Offer accepted (terms agreed)', acceptedApp?.approvedTime || acceptedApp?.updatedAt],
    ['Work started (QR handshake)', job.startedAt],
    ['Completion submitted', job.completionRequest?.requestedAt || job.completionRequest?.createdAt],
    ['Completion confirmed by provider', job.completionConfirmedAt],
    ['Payment confirmed', job.paymentConfirmedAt],
    ['Job completed', job.completedAt],
  ].filter(([, d]) => d).map(([label, d]) => `<tr><td>${esc(label)}</td><td>${sast(d)}</td></tr>`).join('');

  const handshakeRows = (Array.isArray(job.handshakeLog) ? job.handshakeLog : []).map(h => `
    <tr>
      <td>${esc((h.event || '').replace(/_/g, ' '))}</td>
      <td>${sast(h.triggeredAt || h.at)}</td>
      <td>${esc(h.method || '')}</td>
      <td>${gps(h.posterLocation)} / ${gps(h.providerLocation)}</td>
    </tr>`).join('');

  const proofRows = (Array.isArray(job.workProofPhotos) ? job.workProofPhotos : []).map((p, i) => {
    const uploader = p.uploadedBy?.name || (String(p.uploadedBy?._id || p.uploadedBy) === String(poster._id || poster.id) ? poster.name : provider.name) || 'Party';
    return `
    <tr>
      <td>${i + 1}</td>
      <td>${esc((p.stage || 'during').toUpperCase())}</td>
      <td>${esc(uploader)}</td>
      <td>${sast(p.uploadedAt)}</td>
      <td>${gps(p.location)}</td>
      <td><img src="${absUrl(p.url)}" style="width:110px;height:110px;object-fit:cover;border:1px solid #ccc;border-radius:4px" /></td>
    </tr>`;
  }).join('');

  const issueRows = (Array.isArray(job.issueReports) ? job.issueReports : []).map((r, i) => {
    const reporter = String(r.reporterId) === String(poster._id || poster.id) ? (poster.name || 'Job provider') : (provider.name || 'Helper');
    const photoImgs = (r.photos || []).map(p => `<img src="${absUrl(p.url || p)}" style="width:90px;height:90px;object-fit:cover;border:1px solid #ccc;border-radius:4px;margin:2px" />`).join('');
    return `
    <tr>
      <td>${i + 1}</td>
      <td>${sast(r.createdAt)}</td>
      <td>${esc(reporter)}</td>
      <td>${esc(r.note || '')}</td>
      <td>${photoImgs || '—'}</td>
    </tr>`;
  }).join('');

  const reviewBlocks = [];
  if (job.posterReviewed && job.posterReview) {
    reviewBlocks.push(`<p><strong>${esc(poster.name || 'Job provider')}</strong> rated <strong>${esc(provider.name || 'Helper')}</strong>: ${job.posterReview.overallRating}/5 on ${sast(job.posterReview.createdAt)}${job.posterReview.comment ? ` — “${esc(job.posterReview.comment)}”` : ''}</p>`);
  }
  if (job.providerReviewed && job.providerReview) {
    reviewBlocks.push(`<p><strong>${esc(provider.name || 'Helper')}</strong> rated <strong>${esc(poster.name || 'Job provider')}</strong>: ${job.providerReview.overallRating}/5 on ${sast(job.providerReview.createdAt)}${job.providerReview.comment ? ` — “${esc(job.providerReview.comment)}”` : ''}</p>`);
  }

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Sebenza Work Record — ${esc(job.title)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; margin: 28px; line-height: 1.45; }
  h1 { font-size: 20px; margin: 0; } h2 { font-size: 15px; margin: 22px 0 6px; border-bottom: 1px solid #999; padding-bottom: 3px; }
  .meta { font-size: 11px; color: #444; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 6px; }
  th, td { border: 1px solid #bbb; padding: 5px 7px; text-align: left; vertical-align: top; }
  th { background: #eee; }
  .kv td:first-child { width: 220px; font-weight: bold; background: #f6f6f6; }
  .disclaimer { margin-top: 26px; font-size: 10.5px; color: #333; border: 1px solid #999; padding: 10px 12px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px double #111; padding-bottom: 10px; }
  @media print { .noprint { display: none; } }
</style></head><body>
  <div class="head">
    <div>
      <h1>SEBENZA — WORK &amp; TRANSACTION RECORD</h1>
      <div class="meta">System-generated extract of platform records &nbsp;•&nbsp; Generated ${sast(new Date())}</div>
    </div>
    <div class="meta" style="text-align:right">Job reference:<br><strong>${esc(job._id)}</strong></div>
  </div>

  <h2>1. Parties</h2>
  <table class="kv">
    <tr><td>Job provider (poster)</td><td>${esc(poster.name || 'Unknown')}${poster.verified ? ' — ID verified on platform' : ''}</td></tr>
    <tr><td>Helper (service provider)</td><td>${esc(provider.name || 'Unknown')}${provider.verified ? ' — ID verified on platform' : ''}</td></tr>
  </table>

  <h2>2. Agreement</h2>
  <table class="kv">
    <tr><td>Job title</td><td>${esc(job.title)}</td></tr>
    <tr><td>Category</td><td>${esc(job.category || '—')}</td></tr>
    <tr><td>Description</td><td>${esc(job.description || '—')}</td></tr>
    <tr><td>Agreed amount</td><td>R${esc(agreed)}</td></tr>
    <tr><td>Payment method</td><td>${job.paymentMethod === 'escrow' ? 'Escrow (funds held by platform until completion)' : 'Cash on completion'}</td></tr>
    <tr><td>Job location (GPS)</td><td>${gps(job.location)}</td></tr>
    <tr><td>Current status</td><td>${esc(job.status)}${job.paymentConfirmed ? ' — payment confirmed' : ''}</td></tr>
  </table>

  ${negotiationRows ? `<h2>3. Negotiation history</h2>
  <table><tr><th>#</th><th>Date/time</th><th>Proposed by</th><th>Amount</th><th>Outcome</th><th>Note</th></tr>${negotiationRows}</table>` : ''}

  <h2>4. Recorded timeline</h2>
  <table><tr><th>Event</th><th>Date/time (server-recorded)</th></tr>${timeline || '<tr><td colspan="2">No lifecycle events recorded yet</td></tr>'}</table>

  ${handshakeRows ? `<h2>5. In-person confirmations (QR handshakes)</h2>
  <div class="meta">Both parties scan a one-time QR code in person; GPS coordinates of each party are recorded at scan time (poster / helper).</div>
  <table><tr><th>Event</th><th>Date/time</th><th>Method</th><th>GPS (poster / helper)</th></tr>${handshakeRows}</table>` : ''}

  ${proofRows ? `<h2>6. Proof-of-work photos</h2>
  <div class="meta">All photos were taken with the in-app live camera at the time shown (gallery uploads are not permitted for proof photos) and geo-tagged where location was available.</div>
  <table><tr><th>#</th><th>Stage</th><th>Uploaded by</th><th>Date/time</th><th>GPS</th><th>Photo</th></tr>${proofRows}</table>` : ''}

  ${issueRows ? `<h2>7. Issue reports</h2>
  <table><tr><th>#</th><th>Date/time</th><th>Reported by</th><th>Description</th><th>Photos</th></tr>${issueRows}</table>` : ''}

  ${reviewBlocks.length ? `<h2>8. Ratings exchanged</h2>${reviewBlocks.join('')}` : ''}

  <div class="disclaimer">
    <strong>About this record:</strong> This document is a system-generated extract of records held by the Sebenza platform.
    All timestamps are server-recorded and shown in South African Standard Time (SAST, UTC+2). GPS coordinates are recorded
    from the parties' devices at the moment of the event. Proof photos can only be captured with the in-app camera at the time
    of upload. This record may be used to support a claim or defence in dispute resolution, including proceedings in the
    Small Claims Court (monetary claims up to R20 000 — Small Claims Courts Act 61 of 1984). This document is provided for
    record-keeping purposes and does not constitute legal advice.
  </div>

  <div class="noprint" style="margin-top:20px">
    <button onclick="window.print()" style="padding:10px 22px;font-size:14px;cursor:pointer">🖨 Print / Save as PDF</button>
  </div>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
