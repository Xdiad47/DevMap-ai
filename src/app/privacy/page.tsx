import type { Metadata } from "next";
import { LegalPage, Plain, type LegalSection } from "@/components/layout/LegalPage";
import { getCompany } from "@/lib/company";

export const metadata: Metadata = { title: "Privacy Policy", description: "What personal data DevMap.in collects, why, who sees it, and your rights." };

export default function Privacy() {
  const c = getCompany();
  const sections: LegalSection[] = [
    {
      id: "summary",
      title: "The short version",
      body: (
        <Plain>
          Talent control what is public: only a first name and last initial, city, skills, scores and an Online flag. Phone, email, full name, WhatsApp and links are revealed to a recruiter <strong>only after they pay to unlock you</strong>, and only because you agreed to that. We do not sell personal data and we do not show ads.
        </Plain>
      ),
    },
    {
      id: "who",
      title: "Who is responsible",
      body: (
        <p>
          {c.legalName ?? "The operator of DevMap.in"} (&ldquo;we&rdquo;) decides why and how your personal data is used, which makes us the &ldquo;Data Fiduciary&rdquo; under India&apos;s Digital Personal Data Protection Act, 2023 (DPDP Act). {c.address ? `Our registered address is ${c.address}. ` : ""}Contact: <a href={`mailto:${c.supportEmail}`}>{c.supportEmail}</a>.
        </p>
      ),
    },
    {
      id: "collect",
      title: "What we collect, and why",
      body: (
        <>
          <p>We ask for consent before listing you, before disclosing your contact to a paying recruiter, and before processing your phone number. Here is everything we hold:</p>
          <table>
            <thead><tr><th>Data</th><th>Whose</th><th>Why</th></tr></thead>
            <tbody>
              <tr><td>Name, email, WhatsApp number</td><td>Talent (recruiters give name and email only)</td><td>To run your account, send you alerts, and (for talent, after payment) let a recruiter reach you. The number is entered by you and is not verified by us.</td></tr>
              <tr><td>City and state; skills, languages, hourly rate</td><td>Talent</td><td>To show you in the directory and match searches. Map pins show the <strong>city centre</strong>, never an address.</td></tr>
              <tr><td>GitHub username and public activity (commit counts and dates, repository names, homepage field)</td><td>Developers</td><td>To compute your work score and verify project ownership. We use public data only and never ask for access to private repositories.</td></tr>
              <tr><td>Project titles and live website addresses; website availability checks</td><td>Talent</td><td>To prove your work is live. We request your site a few times a day and record whether it answered, and how fast.</td></tr>
              <tr><td>Portfolio links and reviewer scores</td><td>Designers, marketers</td><td>For manual review of your work.</td></tr>
              <tr><td>Company name, GSTIN (optional), payments, credit balance and history, unlocks</td><td>Recruiters</td><td>To sell and account for credits, issue invoices, and prevent abuse.</td></tr>
              <tr><td>Emails you send to us as evidence (for example a screenshot answering a report)</td><td>Talent</td><td>To resolve disputes fairly.</td></tr>
              <tr><td>Client e-mail address or number you give us to confirm a project</td><td>Your client</td><td>To send <strong>one</strong> confirmation request. We store only a masked label and a one-way hash to enforce limits; not the address itself.</td></tr>
              <tr><td>Your consents, with date, IP address, browser details and policy version</td><td>Everyone</td><td>As legal proof that you agreed.</td></tr>
              <tr><td>Technical data: IP address, device/browser, log entries</td><td>Everyone</td><td>Security, fraud prevention and fixing faults.</td></tr>
            </tbody>
          </table>
        </>
      ),
    },
    {
      id: "visible",
      title: "Who can see what",
      body: (
        <table>
          <thead><tr><th>Level</th><th>What</th><th>Who sees it</th></tr></thead>
          <tbody>
            <tr><td><strong>Public</strong></td><td>Masked name (&ldquo;Rahul S.&rdquo;), city, languages, skills, rate, scores, rank, Online flag, generic project titles</td><td>Anyone using the directory</td></tr>
            <tr><td><strong>Locked</strong></td><td>Full name, WhatsApp number, verified project links</td><td>You, and a recruiter <strong>after they pay</strong> to unlock you</td></tr>
            <tr><td><strong>Private</strong></td><td>Email, GitHub ID</td><td>You, and our staff when needed to run the service</td></tr>
            <tr><td><strong>Financial</strong></td><td>Payments, credit history, GSTIN</td><td>The recruiter, and our staff</td></tr>
          </tbody>
        </table>
      ),
    },
    {
      id: "sharing",
      title: "Who else handles your data",
      body: (
        <>
          <p>We use trusted providers to run DevMap.in. They process data for us under their own security commitments and may only use it to provide their service:</p>
          <ul>
            <li><strong>Razorpay</strong>: payments. They handle your UPI/bank details; we never see them.</li>
            <li><strong>Our database and sign-in provider</strong> (Supabase) and website hosting provider: store the data described above and run the site.</li>
            <li><strong>An email provider</strong>: sends sign-in codes, lead alerts to talent and client confirmation requests.</li>
            <li><strong>GitHub</strong>: if you sign in with it (required for developers), it tells us your account name and email.</li>
            <li><strong>A map-tile provider</strong> (currently CARTO, using OpenStreetMap data): your browser asks them for map images, so they can see your IP address.</li>
          </ul>
          <p>We may also disclose data where the law requires it, to respond to lawful requests from authorities, or to protect people from fraud and harm. We do not sell personal data.</p>
        </>
      ),
    },
    {
      id: "consent",
      title: "Consent, and taking it back",
      body: (
        <>
          <p>Talent are asked to agree separately to: (1) being listed in the directory, (2) sharing contact details with recruiters who pay, and (3) processing their phone number. You may withdraw consent at any time. <strong>Withdrawing listing or disclosure consent hides your profile immediately.</strong> Withdrawal does not undo what already happened, for example a contact a recruiter has already unlocked.</p>
          <p>Cookies: we use only the cookies needed to keep you signed in. We do not use advertising or cross-site tracking cookies.</p>
        </>
      ),
    },
    {
      id: "retention",
      title: "How long we keep data",
      body: (
        <table>
          <thead><tr><th>Record</th><th>Kept</th></tr></thead>
          <tbody>
            <tr><td>Payments, credit ledger, unlock records, consent evidence</td><td><strong>7 years</strong>, for tax and legal reasons, even if you delete your account</td></tr>
            <tr><td>Website availability check results</td><td>60 days</td></tr>
            <tr><td>Client confirmation requests</td><td>Links expire after 7 days; masked label and hash are kept with the project record</td></tr>
            <tr><td>Everything else on your profile</td><td>Until you ask us to delete it</td></tr>
          </tbody>
        </table>
      ),
    },
    {
      id: "rights",
      title: "Your rights, and deleting your account",
      body: (
        <>
          <p>Under the DPDP Act you may: ask for a summary of the data we hold and how it is used; ask us to correct or complete it; ask us to erase it; withdraw consent; and have your complaint heard (below). You may also nominate someone to exercise these rights if you die or cannot act for yourself.</p>
          <p>To use any of them, email <a href={`mailto:${c.supportEmail}`}>{c.supportEmail}</a> from the address on your account. We will verify it is you.</p>
          <p><strong>When you delete your account:</strong> your private details, projects, checks and rank history are deleted. Your public profile becomes an anonymous placeholder (&ldquo;Deleted talent&rdquo;) because paid unlock records must still point to something. Payment and credit records are kept for 7 years but are no longer linked to your name or phone number; consent records are kept with your identifying details removed. If you are a recruiter with unused credits, they must be refunded or forfeited first.</p>
        </>
      ),
    },
    {
      id: "security",
      title: "Keeping it safe",
      body: (
        <p>Access to personal data is restricted by default; contact details are released only through a single protected function after payment; payments run through Razorpay; and staff actions on accounts are logged. No system is perfectly secure. If a breach affects your personal data, we will tell you and the authorities as the law requires.</p>
      ),
    },
    {
      id: "children",
      title: "Children",
      body: <p>DevMap.in is for people aged 18 and over. We do not knowingly collect data from children. If you think a child has registered, tell us and we will remove the account.</p>,
    },
    {
      id: "grievance",
      title: "Complaints and our Grievance Officer",
      body: (
        <>
          <p>If you have a concern about your data, write to our Grievance Officer{c.grievanceName ? `, ${c.grievanceName},` : ""} at <a href={`mailto:${c.grievanceEmail}`}>{c.grievanceEmail}</a>. We aim to acknowledge within {c.replyTime} and resolve as quickly as we can. If you are not satisfied, you may complain to the Data Protection Board of India once it is operational.</p>
          <p>We may update this policy; the date at the top shows the latest version, and we will tell you about important changes.</p>
        </>
      ),
    },
  ];
  return <LegalPage title="Privacy Policy" summary="What we collect, why we collect it, who can see it, and how you stay in control." sections={sections} accent="from-indigo-500 to-pink-500" showVersion />;
}
