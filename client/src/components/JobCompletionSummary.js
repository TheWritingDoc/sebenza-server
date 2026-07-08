import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { getImageUrl, PLACEHOLDER_IMG, categoryEmojis } from '../shared/constants';
import { scrollToRef } from '../shared/workflowFocus';
import printJobRecord from '../shared/printJobRecord';

const API_URL = process.env.REACT_APP_API_URL || '';

function StarRating({ rating }) {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    stars.push(
      <span key={i} style={{ fontSize: 18, color: i <= (rating || 0) ? '#f59e0b' : '#e2e8f0' }}>★</span>
    );
  }
  return <div style={{ display: 'flex', gap: 2 }}>{stars}</div>;
}

function PhotoGrid({ photos, label, borderColor, onPhotoClick }) {
  if (!photos || photos.length === 0) {
    return (
      <div style={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#94a3b8', background: '#f8fafc', borderRadius: 14, border: `2px dashed ${borderColor}` }}>
        No {label.toLowerCase()} photos
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8 }}>
      {photos.map((img, i) => (
        <div key={i} style={{ position: 'relative', aspectRatio: '1', borderRadius: 14, overflow: 'hidden', border: `2px solid ${borderColor}`, cursor: 'pointer' }} onClick={() => onPhotoClick(photos, i)}>
          <img loading="lazy" src={getImageUrl(img)} alt="" onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      ))}
    </div>
  );
}

function Section({ title, icon, children, borderColor = '#e2e8f0', accentColor = '#1e293b' }) {
  return (
    <div style={{ borderRadius: 20, overflow: 'hidden', border: `1px solid ${borderColor}`, marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: accentColor, padding: '14px 18px', background: '#f8fafc', borderBottom: `1px solid ${borderColor}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18 }}>{icon}</span> {title}
      </div>
      <div style={{ padding: 18, background: 'white' }}>{children}</div>
    </div>
  );
}

export default function JobCompletionSummary({ job, userId, onClose, onPhotoClick }) {
  const paymentStatusRef = useRef(null);
  const issueReportsRef = useRef(null);

  // Late rating: if the viewer hasn't rated yet (Work Hub auto-closes on
  // completion), they can still submit their stars right here.
  const [myRating, setMyRating] = useState(5);
  const [myComment, setMyComment] = useState('');
  const [submittingRating, setSubmittingRating] = useState(false);
  const [ratingDone, setRatingDone] = useState(false);
  const [ratingError, setRatingError] = useState('');

  useEffect(() => {
    if (!job) return;
    const issueReports = job.issueReports || [];
    const target = job.status === 'pending_payment'
      ? paymentStatusRef
      : issueReports.length > 0
        ? issueReportsRef
        : null;
    if (!target) return;
    const t = scrollToRef(target, { delay: 120, block: 'start' });
    return () => clearTimeout(t);
  }, [job?.status, job?.issueReports?.length]);

  if (!job) return null;

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const poster = job.posterId || {};
  const acceptedApp = job.applications?.find(a => a.status === 'accepted' || a._id?.toString?.() === job.acceptedApplicationId?.toString?.());
  const provider = acceptedApp?.applicantId || {};
  const posterName = poster.name || 'Client';
  const providerName = provider.name || 'Provider';
  const posterAvatar = poster.avatar;
  const providerAvatar = provider.avatar;
  const category = job.category || 'Other';
  const emoji = categoryEmojis[category] || '✨';
  const negotiationHistory = acceptedApp?.negotiationHistory || [];
  const issueReports = job.issueReports || [];

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#f1f5f9',
      zIndex: 10030, display: 'flex', flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        background: 'white', borderBottom: '1px solid #e2e8f0',
        padding: isMobile ? '12px 16px' : '16px 24px',
        display: 'flex', alignItems: 'center', gap: 12,
        flexShrink: 0, position: 'sticky', top: 0, zIndex: 10
      }}>
        <button onClick={onClose} style={{
          width: 40, height: 40, borderRadius: '50%', border: 'none',
          background: '#f1f5f9', cursor: 'pointer', fontSize: 20, color: '#475569',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
        }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: isMobile ? 15 : 17, fontWeight: 800, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.title}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Completion Summary</div>
        </div>
        <button onClick={() => printJobRecord(job)} style={{
          padding: '9px 14px', borderRadius: 12, border: '1px solid #cbd5e1', background: 'white',
          color: '#334155', fontSize: 12, fontWeight: 800, cursor: 'pointer', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 6
        }}>🖨 Print Record</button>
      </div>

      {/* Scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: isMobile ? '12px 16px 40px' : '20px 24px 40px' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>

          {/* Completion Hero */}
          <div style={{
            background: 'linear-gradient(135deg, #d1fae5, #bbf7d0)', borderRadius: 24,
            padding: isMobile ? '24px 20px' : '32px 28px', border: '1px solid #86efac',
            marginBottom: 20, textAlign: 'center'
          }}>
            <div style={{ fontSize: 48, marginBottom: 10 }}>🏆</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#065f46' }}>
              {job.status === 'pending_payment' ? 'Work Completed!' : 'Job Completed!'}
            </div>
            <div style={{ fontSize: 13, color: '#15803d', marginTop: 6 }}>
              {job.completedAt ? new Date(job.completedAt).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : ''}
            </div>
            {job.paymentConfirmed && (
              <div style={{ marginTop: 12, display: 'inline-block', background: '#065f46', color: 'white', padding: '5px 16px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
                ✅ Payment Confirmed
                {job.paymentWaitTimeMinutes !== undefined && <span> — ⏱️ {job.paymentWaitTimeMinutes} min wait</span>}
              </div>
            )}
            {!job.paymentConfirmed && job.status === 'pending_payment' && (
              <div style={{ marginTop: 12, display: 'inline-block', background: '#f59e0b', color: 'white', padding: '5px 16px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
                ⏳ Awaiting Payment Confirmation
              </div>
            )}
          </div>

          {/* Job Info */}
          <div style={{
            background: 'white', borderRadius: 24, padding: isMobile ? '20px 18px' : '24px',
            border: '1px solid #e2e8f0', marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              <div style={{
                width: 56, height: 56, borderRadius: 18,
                background: categoryGradientsSafe(category),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 28, flexShrink: 0
              }}>{emoji}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#1e293b', lineHeight: 1.3 }}>{job.title}</div>
                <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{category}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#22c55e' }}>
                  R{acceptedApp?.approvedAmount || acceptedApp?.proposedAmount || job.budget || 0}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Paid</div>
              </div>
            </div>

            {job.description && (
              <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, margin: '0 0 16px' }}>{job.description}</p>
            )}

            {/* Parties */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px 0', borderTop: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'flex-end' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{posterName}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Client</div>
                </div>
                <img src={getImageUrl(posterAvatar)} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', border: '2px solid #e2e8f0' }} onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }} />
              </div>
              <div style={{ fontSize: 22, color: '#cbd5e1' }}>⇄</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                <img src={getImageUrl(providerAvatar)} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', border: '2px solid #e2e8f0' }} onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{providerName}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Helper</div>
                </div>
              </div>
            </div>
          </div>

          {/* NEGOTIATION TIMELINE */}
          {negotiationHistory.length > 0 && (
            <Section title="Negotiation" icon="💬" borderColor="#e0e7ff" accentColor="#4338ca">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {negotiationHistory.map((entry, i) => {
                  const isPosterOffer = entry.proposedBy?.toString?.() === poster._id?.toString?.() || entry.proposedBy?.toString?.() === poster.toString?.();
                  const name = isPosterOffer ? posterName : providerName;
                  const avatar = isPosterOffer ? posterAvatar : providerAvatar;
                  return (
                    <div key={i} style={{ display: 'flex', gap: 10, flexDirection: isPosterOffer ? 'row' : 'row-reverse', alignItems: 'flex-start' }}>
                      <img src={getImageUrl(avatar)} alt="" onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }}
                        style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid white', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }} />
                      <div style={{
                        background: isPosterOffer ? '#f8fafc' : '#eef2ff', borderRadius: 16, padding: '12px 14px',
                        border: `1px solid ${isPosterOffer ? '#e2e8f0' : '#c7d2fe'}`, maxWidth: '75%', minWidth: 0
                      }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: isPosterOffer ? '#475569' : '#4338ca', marginBottom: 4 }}>
                          {name}
                          <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500, marginLeft: 6 }}>{new Date(entry.createdAt).toLocaleString()}</span>
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#1e293b', marginBottom: entry.message ? 6 : 0 }}>
                          R{entry.amount}
                          {entry.status === 'accepted' && <span style={{ fontSize: 12, color: '#22c55e', marginLeft: 8 }}>✅ Accepted</span>}
                          {entry.status === 'rejected' && <span style={{ fontSize: 12, color: '#ef4444', marginLeft: 8 }}>❌ Rejected</span>}
                          {entry.status === 'pending' && <span style={{ fontSize: 12, color: '#f59e0b', marginLeft: 8 }}>⏳ Pending</span>}
                        </div>
                        {entry.message && <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.5 }}>{entry.message}</div>}
                        {entry.proposedTime && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>🕐 {new Date(entry.proposedTime).toLocaleString()}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* ISSUE REPORTS */}
          {issueReports.length > 0 && (
            <Section title="Issue Reports" icon="🚨" borderColor="#fca5a5" accentColor="#991b1b">
              <div ref={issueReportsRef} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {issueReports.map((report, ri) => {
                  const reporter = report.reporterId || {};
                  const isReporterPoster = reporter._id?.toString?.() === poster._id?.toString?.() || reporter.toString?.() === poster.toString?.();
                  const reporterName = isReporterPoster ? posterName : providerName;
                  return (
                    <div key={ri} style={{ background: '#fef2f2', borderRadius: 16, padding: 14, border: '1px solid #fca5a5' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#991b1b', background: '#fee2e2', padding: '3px 10px', borderRadius: 20 }}>{reporterName}</span>
                        <span style={{ fontSize: 11, color: '#b91c1c' }}>{new Date(report.createdAt || report.reportedAt).toLocaleString()}</span>
                      </div>
                      {report.note && (
                        <div style={{ fontSize: 14, color: '#7f1d1d', lineHeight: 1.55, marginBottom: report.photos?.length > 0 ? 10 : 0 }}>{report.note}</div>
                      )}
                      {report.photos?.length > 0 && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {report.photos.map((p, i) => (
                            <img key={i} src={getImageUrl(p)} alt="" onClick={() => onPhotoClick(report.photos, i)}
                              onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }}
                              style={{ width: 80, height: 80, borderRadius: 12, objectFit: 'cover', cursor: 'pointer', border: '1px solid #fca5a5' }} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Before & After Photos */}
          <Section title="Photos" icon="📸" borderColor="#e2e8f0" accentColor="#1e293b">
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#991b1b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} /> Before
              </div>
              <PhotoGrid photos={job.images} label="Before" borderColor="#fecaca" onPhotoClick={onPhotoClick} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#166534', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} /> After
              </div>
              <PhotoGrid photos={job.workProofPhotos} label="After" borderColor="#bbf7d0" onPhotoClick={onPhotoClick} />
            </div>
          </Section>

          {/* Payment Status */}
          {job.paymentConfirmed !== undefined && (
            <div ref={paymentStatusRef} style={{ marginBottom: 20, background: job.paymentConfirmed ? '#f0fdf4' : '#fffbeb', borderRadius: 14, padding: '14px 16px', border: `1px solid ${job.paymentConfirmed ? '#bbf7d0' : '#fde68a'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: job.paymentConfirmed ? '#166534' : '#92400e' }}>
                    {job.paymentConfirmed ? '✅ Payment Confirmed & Funds Released' : '⏳ Awaiting Payment Confirmation'}
                  </div>
                  {job.paymentConfirmedAt && (
                    <div style={{ fontSize: 11, color: job.paymentConfirmed ? '#15803d' : '#a16207', marginTop: 4 }}>
                      Confirmed on {new Date(job.paymentConfirmedAt).toLocaleString()}
                    </div>
                  )}
                </div>
                {job.paymentWaitTimeMinutes !== undefined && job.paymentConfirmed && (
                  <div style={{ background: '#dcfce7', borderRadius: 10, padding: '6px 12px', fontSize: 12, fontWeight: 700, color: '#166534', border: '1px solid #bbf7d0', textAlign: 'center' }}>
                    <div style={{ fontSize: 16 }}>⏱️</div>
                    <div>{job.paymentWaitTimeMinutes} min</div>
                    <div style={{ fontSize: 10, fontWeight: 500 }}>wait time</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Rate the other party if the viewer hasn't yet */}
          {(() => {
            const uid = String(userId || '');
            const iAmPoster = String(poster._id || poster.id || job.posterId || '') === uid;
            const iAmProvider = String(provider._id || provider.id || '') === uid;
            if (!iAmPoster && !iAmProvider) return null;
            const iHaveRated = iAmPoster ? job.posterReviewed : job.providerReviewed;
            if (iHaveRated || ratingDone) return null;
            const otherLabel = iAmPoster ? providerName : posterName;
            const submit = async () => {
              setSubmittingRating(true);
              setRatingError('');
              try {
                const token = localStorage.getItem('token');
                await axios.post(`${API_URL}/api/jobs/${job._id}/review`, {
                  rating: myRating,
                  comment: myComment,
                  target: iAmPoster ? 'provider' : 'poster'
                }, { headers: { Authorization: `Bearer ${token}` } });
                setRatingDone(true);
              } catch (err) {
                setRatingError(err.response?.data?.error || 'Failed to submit rating');
              } finally {
                setSubmittingRating(false);
              }
            };
            return (
              <Section title={`Rate ${otherLabel}`} icon="⭐" borderColor="#f59e0b" accentColor="#92400e">
                <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 10 }}>
                  {[1, 2, 3, 4, 5].map(star => (
                    <button key={star} onClick={() => setMyRating(star)} style={{ border: 'none', background: 'transparent', fontSize: 32, cursor: 'pointer', padding: 2, filter: star <= myRating ? 'none' : 'grayscale(1) opacity(0.35)' }}>⭐</button>
                  ))}
                </div>
                <input value={myComment} onChange={e => setMyComment(e.target.value)} placeholder="Optional comment..." style={{ width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 10, border: '1px solid #fde68a', fontSize: 13, marginBottom: 10 }} />
                {ratingError && <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 700, marginBottom: 8 }}>{ratingError}</div>}
                <button onClick={submit} disabled={submittingRating} style={{ width: '100%', padding: '12px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: 'white', fontSize: 14, fontWeight: 800, cursor: submittingRating ? 'not-allowed' : 'pointer', opacity: submittingRating ? 0.6 : 1 }}>
                  {submittingRating ? '⏳ Submitting...' : `Submit ${myRating}★ Rating`}
                </button>
              </Section>
            );
          })()}
          {ratingDone && (
            <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 14, background: '#fefce8', border: '1px solid #fde68a', color: '#854d0e', fontSize: 13, fontWeight: 700 }}>
              ⭐ Thanks! Your rating was submitted.
            </div>
          )}

          {/* Ratings & Reviews */}
          {(job.posterReviewed || job.providerReviewed) && (
            <Section title="Reviews" icon="⭐" borderColor="#fde68a" accentColor="#92400e">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {job.posterReviewed && (
                  <div style={{ background: '#fef9c3', borderRadius: 16, padding: 14, border: '1px solid #fde68a' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <img src={getImageUrl(posterAvatar)} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', border: '2px solid #fde68a' }} onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }} />
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#854d0e' }}>{posterName} rated {providerName}</div>
                          <div style={{ fontSize: 11, color: '#a16207' }}>Neighbour → Helper</div>
                        </div>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#f59e0b' }}>{job.posterReview?.overallRating || '-'}/5</div>
                    </div>
                    <StarRating rating={job.posterReview?.overallRating} />
                    {job.posterReview?.comment && (
                      <div style={{ fontSize: 13, color: '#713f12', lineHeight: 1.5, background: 'rgba(255,255,255,0.6)', padding: '10px 12px', borderRadius: 12, marginTop: 10 }}>
                        "{job.posterReview.comment}"
                      </div>
                    )}
                    {job.posterReview?.createdAt && (
                      <div style={{ fontSize: 11, color: '#a16207', marginTop: 8 }}>Reviewed on {new Date(job.posterReview.createdAt).toLocaleDateString()}</div>
                    )}
                  </div>
                )}
                {job.providerReviewed && (
                  <div style={{ background: '#dbeafe', borderRadius: 16, padding: 14, border: '1px solid #93c5fd' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <img src={getImageUrl(providerAvatar)} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', border: '2px solid #93c5fd' }} onError={(e) => { e.target.onerror = null; e.target.src = PLACEHOLDER_IMG; }} />
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8' }}>{providerName} rated {posterName}</div>
                          <div style={{ fontSize: 11, color: '#1d4ed8' }}>Helper → Neighbour</div>
                        </div>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#f59e0b' }}>{job.providerReview?.overallRating || '-'}/5</div>
                    </div>
                    <StarRating rating={job.providerReview?.overallRating} />
                    {job.providerReview?.comment && (
                      <div style={{ fontSize: 13, color: '#1e3a8a', lineHeight: 1.5, background: 'rgba(255,255,255,0.6)', padding: '10px 12px', borderRadius: 12, marginTop: 10 }}>
                        "{job.providerReview.comment}"
                      </div>
                    )}
                    {job.providerReview?.createdAt && (
                      <div style={{ fontSize: 11, color: '#1d4ed8', marginTop: 8 }}>Reviewed on {new Date(job.providerReview.createdAt).toLocaleDateString()}</div>
                    )}
                  </div>
                )}
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function categoryGradientsSafe(category) {
  const map = {
    'House Cleaning': 'linear-gradient(135deg, #cffafe, #a5f3fc)', 'Yard Work': 'linear-gradient(135deg, #dcfce7, #bbf7d0)',
    'Car Wash': 'linear-gradient(135deg, #dbeafe, #bfdbfe)', 'Dog Walking': 'linear-gradient(135deg, #ffedd5, #fed7aa)',
    'Laundry': 'linear-gradient(135deg, #eef2ff, #e0e7ff)', 'Braai / BBQ': 'linear-gradient(135deg, #fef3c7, #fde68a)',
    'Haircut': 'linear-gradient(135deg, #fce7f3, #fbcfe8)', 'Errands': 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
    'Pet Wash': 'linear-gradient(135deg, #ecfeff, #cffafe)', 'Shoe Cleaning': 'linear-gradient(135deg, #f5f3ff, #ede9fe)',
    'Moving Help': 'linear-gradient(135deg, #fff7ed, #ffedd5)', 'Furniture Assembly': 'linear-gradient(135deg, #f1f5f9, #e2e8f0)',
    'Gardening': 'linear-gradient(135deg, #dcfce7, #bbf7d0)', 'Babysitting': 'linear-gradient(135deg, #fef3c7, #fde68a)',
    'Cooking': 'linear-gradient(135deg, #ffedd5, #fed7aa)', 'Plumbing': 'linear-gradient(135deg, #dbeafe, #bfdbfe)',
    'Electrical': 'linear-gradient(135deg, #fef3c7, #fde68a)', 'Tech Help': 'linear-gradient(135deg, #ede9fe, #ddd6fe)',
    'Tutoring': 'linear-gradient(135deg, #eef2ff, #e0e7ff)', 'Other': 'linear-gradient(135deg, #f1f5f9, #e2e8f0)'
  };
  return map[category] || map.Other;
}
