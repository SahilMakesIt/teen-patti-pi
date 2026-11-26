import React from "react";

export default function LegalPages({ mode = "privacy", onBack }) {
  const isPrivacy = mode === "privacy";

  return (
    <div
      style={{
        maxWidth: "780px",
        margin: "24px auto",
        padding: "24px",
        borderRadius: "14px",
        background: "#121826",
        color: "#f3f4f6",
        lineHeight: 1.65,
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
        <h1 style={{ margin: 0, fontSize: "24px" }}>
          {isPrivacy ? "Privacy Policy — Classic Teen Patti (Pi)" : "Terms of Service — Classic Teen Patti (Pi)"}
        </h1>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            style={{
              padding: "8px 14px",
              borderRadius: "8px",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Back to Game
          </button>
        )}
      </div>

      {isPrivacy ? (
        <>
          <p><strong>Last Updated:</strong> November 26, 2026</p>
          <p>
            Classic Teen Patti ("we", "our", or "the App") operates on Pi Network and uses Firebase Firestore
            to store gameplay state, virtual chip balances, table seats, and ad cooldown history.
          </p>
          <h2>1. Information We Collect</h2>
          <ul>
            <li><strong>Pi Profile Data:</strong> When authenticated via Pi SDK, we store your Pi username/display name and verification status to identify your player account.</li>
            <li><strong>Gameplay & Economy Data:</strong> We store your in-game chip balance, balance visibility preference (<code>hideBalance</code>), table activity, chip gift records, and rewarded ad timestamps (<code>adHistory</code>).</li>
            <li><strong>Voice Chat Audio:</strong> Microphone access is requested only when you use Hold-to-Talk or Hands-Free voice chat at a table and is transmitted live to connected table peers rather than permanently stored as recordings.</li>
          </ul>
          <h2>2. How We Use Information</h2>
          <ul>
            <li>Authenticate players, persist chip balances and table states, and prevent ad/turn abuse.</li>
            <li>Process Pi SDK transactions and Pi Ad Network rewarded ad completions.</li>
          </ul>
          <h2>3. Contact</h2>
          <p>For support or privacy inquiries, contact us via our official channels linked in the app.</p>
        </>
      ) : (
        <>
          <p><strong>Last Updated:</strong> November 26, 2026</p>
          <h2>1. Virtual Play Chips (Zero Monetary Value)</h2>
          <p>
            All chips, balances, and gifts inside Classic Teen Patti are strictly virtual, free-to-play or
            Pi-Ecosystem entertainment tokens. <strong>Play Chips have zero real-world monetary value</strong> and
            cannot be cashed out, withdrawn, sold, or redeemed for fiat currency or external rewards.
          </p>
          <h2>2. Fair Play, Turn Timer & Voice Chat</h2>
          <ul>
            <li>Active turns enforce a 30-second action timer (<code>chaal</code>/<code>blind</code>/<code>show</code>); inactive turns may auto-pack to keep tables moving.</li>
            <li>Rewarded ads are subject to cooldown and daily usage limits (1 ad every 5 minutes, up to 7 ads per 24 hours).</li>
            <li>Players may toggle balance visibility on tables, use Hold-to-Talk or Hands-Free mic chat, or mute incoming table voice at any time.</li>
          </ul>
          <h2>3. Prohibited Conduct</h2>
          <p>
            Abusing bugs, automating actions, harassing other players in voice chat, or attempting off-platform
            trading of virtual chips may result in account restriction.
          </p>
        </>
      )}
    </div>
  );
}
