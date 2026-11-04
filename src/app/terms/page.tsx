import type { Metadata } from "next";
import { LegalPage, Plain, type LegalSection } from "@/components/layout/LegalPage";
import { getCompany } from "@/lib/company";

export const metadata: Metadata = { title: "Terms of Service", description: "The rules for using DevMap.in as talent or as a recruiter." };

export default function Terms() {
  const c = getCompany();
  const sections: LegalSection[] = [
    {
      id: "what",
      title: "What DevMap.in is",
      body: (
        <>
          <Plain>DevMap.in is a directory that helps businesses find developers, designers and digital marketers. We introduce you. We are not the employer, the agent or a party to any work that follows.</Plain>
          <p>
            Talent list themselves for free and are ranked on proof of work. Recruiters browse the directory and pay with credits to unlock a person&apos;s contact details (name, WhatsApp number and verified project links). After that, you talk directly, usually on WhatsApp. DevMap.in has no chat, takes <strong>no commission</strong> on any project, and holds no money for the work.
          </p>
          <p>
            These Terms are an agreement between you and {c.legalName ?? "the operator of DevMap.in"} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By creating an account or using the site you accept them. If you do not accept them, please do not use DevMap.in.
          </p>
        </>
      ),
    },
    {
      id: "eligibility",
      title: "Who can use it",
      body: (
        <ul>
          <li>You must be <strong>18 or older</strong> and able to enter a binding contract under Indian law.</li>
          <li>You must give accurate information and keep it up to date. One person may have one talent profile and one recruiter account.</li>
          <li>Your mobile number must be verified with a one-time code. Developers must sign in with GitHub (we read only your public GitHub data; we never ask for access to private repositories).</li>
          <li>You are responsible for everything done through your account. Keep your sign-in details safe and tell us at once if you think someone else has used them.</li>
        </ul>
      ),
    },
    {
      id: "talent",
      title: "If you are talent",
      body: (
        <>
          <p><strong>Listing is free.</strong> We never charge talent to be listed or ranked.</p>
          <ul>
            <li><strong>What recruiters see before paying:</strong> your first name and last initial, city, languages, skills, hourly rate, scores and rank, an Online/Offline status, and generic titles of your verified projects. Your full name, phone, email, WhatsApp and links stay hidden until a recruiter pays.</li>
            <li><strong>Your ranking</strong> comes from: your public GitHub activity (developers), a human review of your portfolio (designers and marketers), live projects that you have proved are yours and that stay online, and how quickly you acknowledge leads. We may change how scores are calculated to keep them fair.</li>
            <li><strong>Proof of ownership.</strong> You may only add projects you genuinely built. You prove it by placing a file we give you on the site, by naming it in your own GitHub repository, or by a client confirming. Faking proof, or having a client who is really you confirm it, is grounds for removal.</li>
            <li><strong>Going Online</strong> means &ldquo;I can take work today&rdquo;. It switches off by itself after 8 hours, so that &ldquo;Online&rdquo; stays true.</li>
            <li><strong>Leads.</strong> When someone unlocks you, we email you. Please reply to genuine enquiries promptly. You are not obliged to take any job.</li>
            <li><strong>Strikes.</strong> If a recruiter reports that you never replied, our team reviews it. We may email you to ask for evidence that you replied. If the report is upheld, the recruiter is refunded and you get a strike; if it is rejected, nothing happens to you. Strike 1 is a warning; strike 2 hides you from the map for 14 days; strike 3 suspends you and a person on our team decides whether to remove you permanently. Strikes expire after 90 days. You can appeal by emailing <a href={`mailto:${c.supportEmail}`}>{c.supportEmail}</a> from the email address on your profile.</li>
          </ul>
        </>
      ),
    },
    {
      id: "recruiters",
      title: "If you are a recruiter",
      body: (
        <>
          <ul>
            <li><strong>Credits.</strong> You buy credits and spend them to unlock people. A standard profile costs <strong>1 credit</strong>; a top-tier profile (high score and recently active) costs <strong>2 credits</strong>. The price is shown on the card before you confirm.</li>
            <li><strong>Free preview.</strong> Each verified mobile number gets one free unlock, on a standard-tier profile only. A free preview cannot be refunded or reported.</li>
            <li><strong>Unlocking again.</strong> Once you have unlocked someone you can see their contact again for free. If an unlock is later refunded, access to that contact closes.</li>
            <li><strong>Daily limit.</strong> To protect talent from being flooded, a person can be unlocked by only a limited number of recruiters per day. If they are at their limit you will be told and will not be charged.</li>
            <li><strong>Use contact details only to discuss genuine work.</strong> No spam, no bulk messaging, no selling or sharing the details, no scraping, and no using them to contact someone who has asked you to stop.</li>
            <li><strong>Feedback and reports.</strong> After you have opened WhatsApp, you can give a 👍 or 👎. If a person has not replied, you may report it from 24 hours after you opened WhatsApp until 7 days after the unlock, up to 2 reports a month. Reports must be honest: knowingly false reports can lead to your account being restricted.</li>
          </ul>
          <p>DevMap.in is a lead service. We do not guarantee that anyone will reply, be suitable, or deliver work, and we are not responsible for the quality, price or outcome of any engagement. Agree scope, price and payment terms directly with the person you hire.</p>
        </>
      ),
    },
    {
      id: "payments",
      title: "Credits and payments",
      body: (
        <ul>
          <li>Payments are made in Indian rupees through Razorpay (UPI). We do not see or store your UPI PIN or bank details.</li>
          <li>Prices on the <a href="/pricing">Pricing</a> page <strong>include GST</strong>. We decide the price on our server: it cannot be changed from your browser.</li>
          <li>Credits belong to your account, cannot be transferred or sold, and are not money. At present they do not expire.</li>
          <li>Refunds are covered in the <a href="/refunds">Refunds &amp; Cancellation</a> policy.</li>
        </ul>
      ),
    },
    {
      id: "rules",
      title: "What you must not do",
      body: (
        <ul>
          <li>Give false information, impersonate anyone, or claim work that is not yours.</li>
          <li>Manipulate rankings, scores, uptime, GitHub activity or reviews; create fake accounts; or collude with others to do so.</li>
          <li>Point our checking tools at addresses that are not your own public website, or try to probe our systems or networks.</li>
          <li>Scrape or copy the directory, or use automated tools against the site without our written permission.</li>
          <li>Harass, threaten or discriminate against anyone; post anything unlawful, defamatory or infringing.</li>
          <li>Try to avoid paying for an unlock, interfere with payments, or abuse free previews or refunds.</li>
        </ul>
      ),
    },
    {
      id: "content",
      title: "Your content and our content",
      body: (
        <>
          <p>You keep ownership of what you provide. You allow us to display it as described in these Terms and the Privacy Policy so the service can work. You promise you have the right to share it.</p>
          <p>The DevMap.in name, design, scores and software belong to us. You may not copy them except as the site allows.</p>
        </>
      ),
    },
    {
      id: "disclaimer",
      title: "No guarantees, and limits on our liability",
      body: (
        <>
          <p>
            Scores, ranks, &ldquo;verified&rdquo; badges and uptime figures are indicators based on the information available to us. They are not a certificate of skill, identity or reliability, and we do not endorse any person.
          </p>
          <p>
            We provide the service &ldquo;as is&rdquo; and try to keep it running, but we cannot promise it will always be available or error-free. To the fullest extent the law allows, we are not liable for indirect or consequential loss, loss of profit, or for anything that happens between a recruiter and talent. Our total liability to you for any claim about the service is limited to the amount you paid us in the 12 months before the claim. Nothing in these Terms limits liability that cannot be limited by law.
          </p>
        </>
      ),
    },
    {
      id: "ending",
      title: "Suspension and ending your account",
      body: (
        <>
          <p>We may restrict, suspend or remove an account that breaks these Terms, puts others at risk, or is used to cheat the system. For serious cases (for example a permanent ban) a person reviews the decision, and a banned person&apos;s phone number and GitHub account are blocked from registering again.</p>
          <p>You may ask us to delete your account at any time (see the Privacy Policy for what is kept for legal reasons). Unused credits must be refunded or forfeited first; see Refunds.</p>
        </>
      ),
    },
    {
      id: "changes",
      title: "Changes to these Terms",
      body: <p>We may update these Terms as the service grows. The date at the top shows the latest version. If a change matters, we will tell you in the app or by email. Continuing to use DevMap.in after a change means you accept it.</p>,
    },
    {
      id: "law",
      title: "Governing law and contact",
      body: (
        <>
          <p>These Terms are governed by the laws of India. The courts at {c.jurisdiction} have exclusive jurisdiction, subject to any rights you have under consumer protection law.</p>
          <p>Questions, complaints or notices: <a href={`mailto:${c.supportEmail}`}>{c.supportEmail}</a>. See also our <a href="/contact">Contact</a> page.</p>
        </>
      ),
    },
  ];
  return <LegalPage title="Terms of Service" summary="The rules for talent and recruiters, in plain language. The short version: be honest, be respectful, and pay for what you unlock." sections={sections} showVersion />;
}
