import type { Metadata } from "next";
import { LegalPage, Plain, type LegalSection } from "@/components/layout/LegalPage";
import { getCompany } from "@/lib/company";

export const metadata: Metadata = { title: "Refunds & Cancellation", description: "When credits are refunded, and how to ask." };

export default function Refunds() {
  const c = getCompany();
  const sections: LegalSection[] = [
    {
      id: "model",
      title: "How buying works",
      body: (
        <>
          <Plain>You buy credits once and spend them when you unlock a person. There is no subscription, so there is nothing to cancel and no automatic renewal.</Plain>
          <p>Credits are added to your account as soon as Razorpay confirms the payment, usually within seconds.</p>
        </>
      ),
    },
    {
      id: "automatic",
      title: "When you get your credits back",
      body: (
        <>
          <p>If you unlocked a person with credits, tried to reach them on WhatsApp, and they never replied, you can report it (from 24 hours after you opened WhatsApp, up to 7 days after the unlock). Then:</p>
          <ul>
            <li>We email the person, and our team may ask them for evidence that they replied.</li>
            <li>A member of our team reviews every report and decides, usually within 2 working days.</li>
            <li>If the report is upheld, <strong>you are refunded exactly the credits you paid</strong> for that unlock (1 or 2). If it is rejected, you are not.</li>
          </ul>
          <p>Refunded credits go back into your credit balance. After a refund, access to that person&apos;s contact details closes. You can&apos;t both get the credits back and keep the number.</p>
          <p>Each recruiter can send up to 2 reports a month.</p>
        </>
      ),
    },
    {
      id: "not",
      title: "What is not refunded",
      body: (
        <ul>
          <li><strong>Free previews.</strong> They cost nothing, so they cannot be refunded or reported.</li>
          <li><strong>An unlock where the person replied</strong>, even if the work did not go ahead. We sell the introduction, not the outcome.</li>
          <li><strong>Unlocks you did not report in time</strong> (more than 7 days old) or reported without trying WhatsApp first.</li>
          <li>Dissatisfaction with a person&apos;s price, quality or availability after they replied. Please agree scope and payment with them directly.</li>
        </ul>
      ),
    },
    {
      id: "unused",
      title: "Unused credits and mistaken purchases",
      body: (
        <>
          <p>If you bought credits by mistake or no longer need them, email <a href={`mailto:${c.supportEmail}`}>{c.supportEmail}</a> from your account email with your Razorpay payment ID. We review each request individually. If we approve it, the remaining credits are removed from your account and the matching amount is refunded to the original payment method.</p>
        </>
      ),
    },
    {
      id: "failed",
      title: "Payment problems",
      body: (
        <ul>
          <li><strong>Money left your account but no credits arrived.</strong> Wait a few minutes first: confirmation can lag. If credits are still missing, email us with the Razorpay payment ID or UPI reference. We will either add the credits or refund you.</li>
          <li><strong>Payment failed or was cancelled.</strong> If the money was debited, your bank or Razorpay reverses it automatically; this usually takes 5 to 7 working days.</li>
          <li><strong>Charged twice for the same order.</strong> We credit an order only once. Email us and we will refund the duplicate.</li>
        </ul>
      ),
    },
    {
      id: "timeline",
      title: "How long refunds take",
      body: (
        <p>Credits returned for an upheld report appear in your balance immediately. Money refunded to your bank or UPI account is sent by us to Razorpay on approval and usually reaches you within 5 to 7 working days, depending on your bank.</p>
      ),
    },
    {
      id: "ask",
      title: "How to ask",
      body: (
        <p>Email <a href={`mailto:${c.supportEmail}`}>{c.supportEmail}</a> ({c.hours}). We reply within {c.replyTime}. Please include your registered email or phone number and, for payments, the Razorpay payment ID.</p>
      ),
    },
  ];
  return <LegalPage title="Refunds & Cancellation" summary="No subscriptions to cancel. Here is exactly when credits come back, and how to ask when something went wrong." sections={sections} accent="from-teal-500 to-emerald-500" />;
}
