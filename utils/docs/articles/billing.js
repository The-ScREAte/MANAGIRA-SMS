"use strict";

// Billing and pricing guides, kept exactly as they were.
module.exports = [
  {
    slug: "how-subscription-renewal-amount-is-calculated",
    title: "How subscription renewal amount is calculated",
    topic: "Billing & subscriptions",
    order: 1,
    summary: "Understand why renewal can change based on student count and billing cycle choices.",
    tags: ['renewal', 'student count', 'billing cycles', 'subscription amount', 'free students'],
    rawHtml: `
      <h2>Overview</h2>
      <p>Renewal is not always a permanently fixed number. It can change as your active student count changes.</p>
      <h2>Main factors that affect renewal</h2>
      <ul>
        <li><strong>Student count:</strong> Higher active student counts can move the school into a different pricing tier.</li>
        <li><strong>Billing cycle:</strong> Monthly, term, yearly, or other cycle options can change total amount and discount behavior.</li>
        <li><strong>Plan and region pricing:</strong> The selected plan and location pricing rules are applied at checkout and renewal.</li>
        <li><strong>Free students for your first months:</strong> Some plans include free students only for your first months. After them, every student is charged, and a bill that covers several months counts the free students only for the months still inside that time. <strong>Settings</strong>, <strong>Billing &amp; Plan</strong> shows until when yours are free.</li>
      </ul>
      <h2>What schools should do</h2>
      <ol>
        <li>Keep student records current before renewal dates.</li>
        <li>Review billing settings and cycle choice in advance.</li>
        <li>Check renewal details in the billing area before charge date.</li>
      </ol>
      <div class="doc-callout doc-callout--tip"><strong>Tip:</strong> If your school expects a pricing jump, review student archive and graduation updates before renewal to avoid overcounting inactive learners.</div>
    `,
  },
  {
    slug: "understand-localized-pricing-currency-and-usd-fallback",
    title: "Understand localized pricing, currency detection, and USD fallback",
    topic: "Billing & subscriptions",
    order: 2,
    summary: "How Managira chooses the display currency by location and when it falls back to USD.",
    tags: ['localized pricing', 'currency', 'usd fallback', 'billing currency'],
    rawHtml: `
      <h2>Overview</h2>
      <p>Managira can localize subscription pricing by user location. If location signals are weak or unavailable, pricing falls back to USD.</p>
      <h2>How currency is chosen</h2>
      <ol>
        <li>Trusted country headers from your hosting/network edge.</li>
        <li>IP-based geo detection.</li>
        <li>Safe fallbacks (including language and account context when available).</li>
        <li>USD fallback when no reliable signal is available.</li>
      </ol>
      <h2>Why users can occasionally see USD</h2>
      <ul>
        <li>Geo lookup is blocked or timed out.</li>
        <li>No reliable country signal is available for the request.</li>
        <li>The user is on a network that masks location details.</li>
      </ul>
      <h2>Important note</h2>
      <p>Currency display is for clarity during checkout. The actual charged amount and gateway currency are shown in the payment summary before confirmation.</p>
    `,
  },
];
