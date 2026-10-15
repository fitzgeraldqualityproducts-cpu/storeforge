import robotsParser from "robots-parser";
import { safeFetch, ROBOTS_UA_TOKEN } from "./http";
import type { UrlPolicy } from "./ssrf";

const CACHE_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; robots: ReturnType<typeof robotsParser> | null }>();

/**
 * True if robots.txt allows our User-Agent to fetch the URL. Missing/unreachable robots.txt
 * (404, network error) means allowed, per the Robots Exclusion Protocol (RFC 9309); a 5xx
 * response is treated as "disallow everything" as the RFC recommends.
 */
export async function robotsAllows(url: string, policy: UrlPolicy): Promise<boolean> {
  const u = new URL(url);
  const robotsUrl = `${u.origin}/robots.txt`;
  const hit = cache.get(u.origin);
  let robots = hit && Date.now() - hit.at < CACHE_MS ? hit.robots : undefined;
  if (robots === undefined) {
    try {
      const res = await safeFetch(robotsUrl, {
        policy,
        maxBytes: 512 * 1024,
        timeoutMs: 8000,
        accept: "text/plain,*/*;q=0.5",
        retries: 0,
      });
      if (res.status >= 500) {
        robots = robotsParser(robotsUrl, "User-agent: *\nDisallow: /");
      } else if (res.status >= 400) {
        robots = null;
      } else {
        robots = robotsParser(robotsUrl, res.body.toString("utf8"));
      }
    } catch {
      robots = null;
    }
    cache.set(u.origin, { at: Date.now(), robots });
  }
  if (!robots) return true;
  return robots.isAllowed(url, ROBOTS_UA_TOKEN) !== false;
}

export function clearRobotsCache() {
  cache.clear();
}
