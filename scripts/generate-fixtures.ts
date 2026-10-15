/**
 * Generates the sample product images used by tests and the fixture product page:
 * three 1200×1200 product photos (hero, angle, detail) plus a 64px icon that the scraper must
 * filter out. Run with `npm run fixtures`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const out = path.resolve(__dirname, "..", "tests", "fixtures", "site", "images");
mkdirSync(out, { recursive: true });

function dripperSvg(opts: {
  bg: string;
  body: string;
  angle: number;
  detail?: boolean;
  label: string;
}) {
  const { bg, body, angle, detail, label } = opts;
  const scale = detail ? 1.9 : 1;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
  <defs>
    <radialGradient id="bg" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="${bg}"/></radialGradient>
    <linearGradient id="glaze" x1="0" x2="1"><stop offset="0" stop-color="${body}"/><stop offset="0.45" stop-color="#f4efe6"/><stop offset="1" stop-color="${body}"/></linearGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="18"/></filter>
  </defs>
  <rect width="1200" height="1200" fill="url(#bg)"/>
  <ellipse cx="600" cy="1010" rx="330" ry="40" fill="#000" opacity="0.18" filter="url(#soft)"/>
  <g transform="translate(600 620) rotate(${angle}) scale(${scale}) translate(-600 -620)">
    <path d="M330 380 L870 380 L700 820 L500 820 Z" fill="url(#glaze)" stroke="#5b4a3a" stroke-width="6"/>
    <ellipse cx="600" cy="380" rx="270" ry="48" fill="#efe7da" stroke="#5b4a3a" stroke-width="6"/>
    <ellipse cx="600" cy="380" rx="225" ry="34" fill="#3b2f25" opacity="0.85"/>
    ${[0, 1, 2, 3, 4, 5].map((i) => `<path d="M${420 + i * 36} 420 L${520 + i * 16} 780" stroke="#8a7560" stroke-width="5" opacity="0.6"/>`).join("")}
    <rect x="430" y="820" width="340" height="40" rx="14" fill="#d9cdbb" stroke="#5b4a3a" stroke-width="6"/>
    <rect x="560" y="860" width="80" height="120" rx="10" fill="#f6f1e8" stroke="#5b4a3a" stroke-width="6"/>
  </g>
  <text x="60" y="1150" font-family="sans-serif" font-size="34" fill="#6b5a48" opacity="0.7">${label}</text>
</svg>`;
}

async function main() {
  const images = [
    {
      file: "dripper-1.jpg",
      svg: dripperSvg({ bg: "#e9e2d6", body: "#cdbfa9", angle: 0, label: "hero" }),
    },
    {
      file: "dripper-2.jpg",
      svg: dripperSvg({ bg: "#dfe6e2", body: "#a9bcb3", angle: -12, label: "angle" }),
    },
    {
      file: "dripper-3.jpg",
      svg: dripperSvg({ bg: "#efe4dc", body: "#c9a99a", angle: 4, detail: true, label: "detail" }),
    },
  ];
  for (const img of images) {
    const buf = await sharp(Buffer.from(img.svg)).jpeg({ quality: 88 }).toBuffer();
    writeFileSync(path.join(out, img.file), buf);
  }
  const icon = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "#cc3300" },
  })
    .png()
    .toBuffer();
  writeFileSync(path.join(out, "cart-icon.png"), icon);
  console.log(`Wrote ${images.length + 1} fixture images to ${out}`);
}

void main();
