import type { ExtractionWarning } from "@/lib/schemas";

const CAPTCHA = [
  /captcha/i,
  /are you a (human|robot)/i,
  /verify (that )?you('| a)re (a )?human/i,
  /robot check/i,
  /unusual traffic/i,
  /px-captcha|perimeterx/i,
  /h-captcha|hcaptcha|recaptcha/i,
  /\/errors\/validatecaptcha/i,
  /slide to verify|punish\?x5secdata|x5sec/i,
];
const ANTI_BOT = [
  /cf-browser-verification|cf-chl-|challenge-platform|just a moment\.\.\./i,
  /attention required!? \| cloudflare/i,
  /access denied|request blocked|you have been blocked|forbidden/i,
  /datadome|incapsula|distil_r_captcha|akamai bot manager|kasada/i,
  /enable (javascript and )?cookies to continue/i,
];
const LOGIN = [
  /sign in to (continue|view|see)/i,
  /log ?in to (continue|view|see)/i,
  /please (sign|log) ?in/i,
  /members only/i,
];

const MSG = "We couldn't read this page automatically. Upload screenshots or photos instead.";

/**
 * Detect anti-bot interstitials, CAPTCHAs and login walls. We never try to bypass them; we
 * report a warning and let the user continue with uploads.
 */
export function detectWalls(html: string, status: number, text: string): ExtractionWarning[] {
  const sample = `${html.slice(0, 60_000)}`;
  const shortPage = text.length < 1500;
  const warnings: ExtractionWarning[] = [];
  if (CAPTCHA.some((re) => re.test(sample)) && (shortPage || status === 403 || status === 429)) {
    warnings.push({ code: "captcha", message: `This page shows a CAPTCHA. ${MSG}` });
  } else if (
    status === 403 ||
    status === 429 ||
    status === 503 ||
    (ANTI_BOT.some((re) => re.test(sample)) && shortPage)
  ) {
    warnings.push({
      code: "anti_bot",
      message: `This site blocks automated visitors (HTTP ${status}). ${MSG}`,
    });
  }
  const hasPassword = /<input[^>]+type=["']?password/i.test(sample);
  if (
    (hasPassword && shortPage) ||
    (LOGIN.some((re) => re.test(text.slice(0, 3000))) && shortPage)
  ) {
    warnings.push({ code: "login_wall", message: `This page requires signing in. ${MSG}` });
  }
  return warnings;
}

export const isBlockingWarning = (w: ExtractionWarning) =>
  w.code === "captcha" || w.code === "anti_bot" || w.code === "login_wall";
