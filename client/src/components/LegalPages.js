import React from 'react';
import { useNavigate } from 'react-router-dom';

// Legal document version — keep in sync with TERMS_VERSION in the server (index.js).
export const TERMS_VERSION = '2026-07-08';
const EFFECTIVE_DATE = '8 July 2026';
const CONTACT_EMAIL = 'support@sebenza.app';

const page = { maxWidth: 760, margin: '0 auto', padding: '20px 18px 90px', color: '#334155', lineHeight: 1.65, fontSize: 15 };
const h1 = { fontSize: 24, fontWeight: 800, color: '#1e293b', margin: '0 0 4px' };
const h2 = { fontSize: 17, fontWeight: 800, color: '#1e293b', margin: '24px 0 8px' };
const meta = { fontSize: 13, color: '#94a3b8', margin: '0 0 20px' };
const li = { margin: '4px 0' };

function BackBar() {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate(-1)} style={{
      background: 'none', border: 'none', color: '#4f46e5', fontSize: 14, fontWeight: 700,
      cursor: 'pointer', marginBottom: 12
    }}>← Back</button>
  );
}

export function PrivacyPolicy() {
  return (
    <div style={page}>
      <BackBar />
      <h1 style={h1}>Privacy Policy</h1>
      <p style={meta}>Effective {EFFECTIVE_DATE} · Version {TERMS_VERSION}</p>

      <p>
        Sebenza ("we", "us") connects people who need help with people nearby who can do the work.
        This policy explains what personal information we collect, why, and your rights under the
        Protection of Personal Information Act, 2013 (POPIA). By using Sebenza you agree to this policy.
      </p>

      <h2 style={h2}>1. Information we collect</h2>
      <ul>
        <li style={li}><strong>Account details</strong> — your name and cell number (required), and optionally your email.</li>
        <li style={li}><strong>Identity documents (KYC)</strong> — if you choose to verify your identity, photos of your ID card (front and back), a selfie, and optionally a driver's licence, proof of address or qualifications. These are used only to confirm who you are.</li>
        <li style={li}><strong>Location</strong> — your approximate area to show nearby jobs, and (only while a job is active and you turn it on) live location to help you and the other party meet.</li>
        <li style={li}><strong>Job activity</strong> — jobs you post or accept, messages with the other party, photos you take as proof of work, ratings and reviews.</li>
        <li style={li}><strong>Payment records</strong> — in-app Rand balance and escrow transactions. We do not store bank card numbers.</li>
        <li style={li}><strong>Device &amp; usage</strong> — basic technical data needed to run the app securely.</li>
      </ul>

      <h2 style={h2}>2. Why we use it</h2>
      <ul>
        <li style={li}>To create and run your account and match you with jobs or workers nearby.</li>
        <li style={li}>To build trust — verified identity and community ratings help everyone feel safe.</li>
        <li style={li}>To process in-app escrow payments and keep transaction records.</li>
        <li style={li}>To keep the community safe: detect fraud, resolve disputes, and act on reports.</li>
      </ul>

      <h2 style={h2}>3. What others can see</h2>
      <p>
        Your public profile shows your name, photo, trust stars, community ratings, skills and an
        <strong> approximate</strong> location (rounded to about 1&nbsp;km) — never your exact address,
        balance, contact details or ID documents. Your ID documents and selfie are stored in a private
        vault and are <strong>never shown publicly</strong>; only you and, where necessary for
        verification or a dispute, our authorised reviewers can access them.
      </p>

      <h2 style={h2}>4. How we protect it</h2>
      <p>
        Data is stored on secured servers. Identity documents are kept in a private storage bucket with
        access controls. Passwords are hashed. Access to sensitive data is limited to what is needed to
        run the service.
      </p>

      <h2 style={h2}>5. Sharing</h2>
      <p>
        We do not sell your personal information. We share it only with: the other party to a job (limited
        to what's needed to complete it), service providers who host or power the app (e.g. our database,
        storage and SMS providers) under confidentiality obligations, and authorities where the law requires it.
      </p>

      <h2 style={h2}>6. Keeping and deleting your data</h2>
      <p>
        We keep your information for as long as your account is active. You may ask us to delete your
        account and personal information at any time; we may retain limited transaction and dispute records
        where the law requires. Identity documents are deleted when no longer needed for verification.
      </p>

      <h2 style={h2}>7. Your rights under POPIA</h2>
      <ul>
        <li style={li}>Access the personal information we hold about you.</li>
        <li style={li}>Ask us to correct or delete it.</li>
        <li style={li}>Object to certain processing or withdraw consent.</li>
        <li style={li}>Lodge a complaint with the Information Regulator (South Africa).</li>
      </ul>
      <p>To exercise any right, contact us at <strong>{CONTACT_EMAIL}</strong>.</p>

      <h2 style={h2}>8. Children</h2>
      <p>Sebenza is not intended for anyone under 18. Do not use the app if you are under 18.</p>

      <h2 style={h2}>9. Changes</h2>
      <p>
        We may update this policy. If we make material changes we'll update the version above and ask you
        to accept again where required.
      </p>

      <h2 style={h2}>10. Contact</h2>
      <p>Questions or requests: <strong>{CONTACT_EMAIL}</strong></p>
    </div>
  );
}

export function TermsOfService() {
  return (
    <div style={page}>
      <BackBar />
      <h1 style={h1}>Terms of Service</h1>
      <p style={meta}>Effective {EFFECTIVE_DATE} · Version {TERMS_VERSION}</p>

      <p>
        These Terms govern your use of Sebenza. By creating an account you agree to them. Please also read
        our Privacy Policy, which forms part of these Terms.
      </p>

      <h2 style={h2}>1. Who can use Sebenza</h2>
      <p>You must be at least 18 years old and provide accurate information. You are responsible for keeping your account secure.</p>

      <h2 style={h2}>2. Sebenza is a marketplace</h2>
      <p>
        We connect people who need help ("posters") with people who offer help ("workers"). We are not the
        employer of any worker and are not a party to the agreement between a poster and a worker. Each user
        is responsible for their own conduct, safety, tax and legal obligations.
      </p>

      <h2 style={h2}>3. Trust stars &amp; verification</h2>
      <p>
        Identity stars reflect how well you have verified who you are; community stars reflect feedback from
        completed jobs. Providing false identity documents, or manipulating ratings, is prohibited and may
        result in removal.
      </p>

      <h2 style={h2}>4. Payments &amp; escrow</h2>
      <p>
        Where a job uses in-app escrow, the agreed amount is held from the poster's balance and released to
        the worker when both parties confirm completion. Cash jobs are settled directly between the parties.
        You agree not to misuse the payment or escrow features.
      </p>

      <h2 style={h2}>5. Your responsibilities</h2>
      <ul>
        <li style={li}>Give honest information and honour the jobs you agree to.</li>
        <li style={li}>Treat other users with respect. Harassment, discrimination, threats and abuse are not allowed.</li>
        <li style={li}>Do not post illegal, dangerous or fraudulent jobs, or use Sebenza to scam anyone.</li>
        <li style={li}>Only upload photos and documents you are allowed to share.</li>
      </ul>

      <h2 style={h2}>6. Reports, flags &amp; removal</h2>
      <p>
        Users can report behaviour. Repeated complaints, unresolved disputes or suspected fraud may lower
        your community rating, flag your account, or lead to suspension or removal. We may remove content or
        accounts that breach these Terms.
      </p>

      <h2 style={h2}>7. Safety</h2>
      <p>
        Meeting strangers and doing work carries risk. Use your judgement, meet in safe places where
        possible, and use the app's verification and rating tools. Sebenza does not screen users beyond the
        verification they choose to complete.
      </p>

      <h2 style={h2}>8. Disclaimer &amp; liability</h2>
      <p>
        Sebenza is provided "as is". To the fullest extent allowed by law, we are not liable for the acts,
        omissions, work quality, or conduct of any user, or for any loss arising from jobs arranged through
        the app. Nothing in these Terms limits rights that cannot be excluded under South African law,
        including the Consumer Protection Act.
      </p>

      <h2 style={h2}>9. Changes &amp; termination</h2>
      <p>
        We may update these Terms; material changes will require you to accept again. You may stop using
        Sebenza and delete your account at any time. We may suspend or terminate accounts that breach these Terms.
      </p>

      <h2 style={h2}>10. Governing law &amp; contact</h2>
      <p>
        These Terms are governed by the laws of the Republic of South Africa. Questions:
        <strong> {CONTACT_EMAIL}</strong>.
      </p>
    </div>
  );
}

export default { PrivacyPolicy, TermsOfService, TERMS_VERSION };
