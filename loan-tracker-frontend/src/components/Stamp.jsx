import React from "react";

// Frontend twin of the backend src/utils/stamp.js renderer. Same
// SVG artwork (three concentric rings, name on top arc, location
// on bottom arc, LF mark in centre, date in a box at the foot)
// so the on-screen Payment Receipt stamp matches the PDF receipt
// stamp byte-for-byte.
//
// The two surfaces must stay in sync if the artwork changes —
// edit both this file AND src/utils/stamp.js together.
//
// Props:
//   lenderName  — top arc, uppercased + truncated to fit
//   location    — bottom arc, " · " between city + country
//                 (caller composes; this component just renders
//                 whatever string is passed)
//   date        — Date, ISO string, or anything new Date() eats.
//                 Defaults to "now" so a fresh receipt shows
//                 today's stamp.
//   size        — output width/height in px (default 100)
//   className   — extra Tailwind classes on the wrapping <svg>

const fitTopArc = (s) =>
  s.length > 38 ? s.slice(0, 37) + "…" : s;

// MUST mirror src/utils/stamp.js topArcType — same thresholds,
// same outputs. Keep these tables identical so the on-screen
// stamp and the PDF stamp render the same name at the same size.
const topArcType = (text) => {
  const len = text.length;
  if (len <= 14) return { fontSize: 23, letterSpacing: 4 };
  if (len <= 18) return { fontSize: 21, letterSpacing: 3 };
  if (len <= 22) return { fontSize: 18, letterSpacing: 2 };
  if (len <= 28) return { fontSize: 16, letterSpacing: 1.5 };
  if (len <= 34) return { fontSize: 14, letterSpacing: 1 };
  return { fontSize: 12, letterSpacing: 0.5 };
};

const botArcType = (text) => {
  const len = text.length;
  if (len <= 16) return { fontSize: 16, letterSpacing: 5 };
  if (len <= 22) return { fontSize: 14, letterSpacing: 3 };
  if (len <= 28) return { fontSize: 12, letterSpacing: 2 };
  return { fontSize: 11, letterSpacing: 1 };
};

const formatStampDate = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  const day = String(dt.getDate()).padStart(2, "0");
  const month = dt
    .toLocaleString("en-GB", { month: "short" })
    .toUpperCase();
  const year = dt.getFullYear();
  return `${day} ${month} ${year}`;
};

function Stamp({
  lenderName = "",
  location = "",
  date = new Date(),
  size = 100,
  className = "",
}) {
  const top = fitTopArc((lenderName || "").toUpperCase());
  const bot = (location || "").toUpperCase();
  const topType = topArcType(top);
  const botType = botArcType(bot);
  const stamp = formatStampDate(date);

  return (
    <svg
      viewBox="0 0 300 300"
      width={size}
      height={size}
      role="img"
      aria-label={`${top} stamp`}
      className={className}
    >
      <defs>
        <path id="lf-stamp-topArc" d="M41,99 A120,120 0 0 1 259,99" />
        <path id="lf-stamp-botArc" d="M52,219 A120,120 0 0 0 248,219" />
      </defs>
      <g fill="none" stroke="#122a2e">
        <circle cx="150" cy="150" r="146" strokeWidth="2.5" />
        <circle cx="150" cy="150" r="138" strokeWidth="5" />
        <circle cx="150" cy="150" r="103" strokeWidth="2" />
      </g>
      <g
        fill="#122a2e"
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight="700"
      >
        <text
          fontSize={topType.fontSize}
          letterSpacing={topType.letterSpacing}
          textAnchor="middle"
        >
          <textPath href="#lf-stamp-topArc" startOffset="50%">
            {top}
          </textPath>
        </text>
        <text
          fontSize={botType.fontSize}
          letterSpacing={botType.letterSpacing}
          textAnchor="middle"
        >
          <textPath href="#lf-stamp-botArc" startOffset="50%">
            {bot}
          </textPath>
        </text>
      </g>
      <polygon points="30,144 36,150 30,156 24,150" fill="#122a2e" />
      <polygon points="270,144 276,150 270,156 264,150" fill="#122a2e" />
      <g fill="#122a2e">
        <rect x="121" y="92" width="15" height="86" rx="3.5" />
        <rect x="121" y="162" width="44" height="16" rx="3.5" />
        <rect x="149" y="92" width="14" height="70" rx="3.5" />
        <rect x="149" y="92" width="30" height="16" rx="3.5" />
        <rect x="149" y="111" width="24" height="14" rx="3.5" />
      </g>
      <rect
        x="96"
        y="196"
        width="108"
        height="26"
        rx="5"
        fill="none"
        stroke="#122a2e"
        strokeWidth="2"
      />
      <text
        x="150"
        y="214"
        fill="#122a2e"
        fontFamily="Arial, sans-serif"
        fontWeight="700"
        fontSize="14"
        letterSpacing="2"
        textAnchor="middle"
      >
        {stamp}
      </text>
    </svg>
  );
}

export default Stamp;
