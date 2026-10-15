import dns from "node:dns";
import ipaddr from "ipaddr.js";

/**
 * SSRF protection. A URL is fetchable only if it is http(s), carries no credentials, is not a
 * local hostname, and every address it resolves to is public unicast. Resolution is re-checked at
 * connect time (see `guardedLookup`) and after every redirect.
 */
export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

const BLOCKED_RANGES = new Set([
  "unspecified",
  "broadcast",
  "multicast",
  "linkLocal", // includes 169.254.169.254 cloud metadata
  "loopback",
  "private", // RFC1918
  "reserved",
  "carrierGradeNat", // 100.64/10 (includes 100.100.100.200 metadata)
  "uniqueLocal", // fc00::/7 (includes fd00:ec2::254 metadata)
  "ipv4Mapped",
  "rfc6145",
  "rfc6052",
  "6to4",
  "teredo",
  "discard",
  "benchmarking",
  "amt",
  "as112",
  "orchid2",
  "droneRemoteIdProtocolEntityTags",
]);

const BLOCKED_HOSTNAMES = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^metadata(\.google\.internal)?$/i,
];

export function isBlockedAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return true;
  let parsed = ipaddr.parse(address);
  if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    parsed = (parsed as ipaddr.IPv6).toIPv4Address();
  }
  const range = parsed.range();
  return BLOCKED_RANGES.has(range);
}

export interface UrlPolicy {
  /** "host:port" pairs that may be fetched even if private (dev/test fixtures only). */
  allowlist: Set<string>;
}

export function hostKey(u: URL) {
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  return `${u.hostname.replace(/^\[|\]$/g, "").toLowerCase()}:${port}`;
}

/** Syntactic checks (no DNS). Throws BlockedUrlError. */
export function assertUrlShape(raw: string, policy: UrlPolicy): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BlockedUrlError("That isn't a valid URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new BlockedUrlError(`Only http and https URLs are allowed (got ${u.protocol}).`);
  }
  if (u.username || u.password)
    throw new BlockedUrlError("URLs with embedded credentials are not allowed.");
  if (policy.allowlist.has(hostKey(u))) return u;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.some((re) => re.test(host))) {
    throw new BlockedUrlError("Local and internal hostnames can't be fetched.");
  }
  if (ipaddr.isValid(host) && isBlockedAddress(host)) {
    throw new BlockedUrlError(
      "Private, loopback, link-local and metadata IP addresses can't be fetched.",
    );
  }
  return u;
}

/** Resolve the hostname and reject if any address is non-public. */
export async function assertResolvesPublic(u: URL, policy: UrlPolicy): Promise<void> {
  if (policy.allowlist.has(hostKey(u))) return;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  let addrs: dns.LookupAddress[];
  try {
    addrs = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new BlockedUrlError(`Couldn't resolve ${host}.`);
  }
  if (!addrs.length) throw new BlockedUrlError(`Couldn't resolve ${host}.`);
  const bad = addrs.find((a) => isBlockedAddress(a.address));
  if (bad) throw new BlockedUrlError(`${host} resolves to a private or reserved address.`);
}

export async function assertSafeUrl(raw: string, policy: UrlPolicy): Promise<URL> {
  const u = assertUrlShape(raw, policy);
  await assertResolvesPublic(u, policy);
  return u;
}

type LookupCb = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

/**
 * A `net.connect` lookup that refuses non-public addresses at connect time, defeating DNS
 * rebinding between the pre-check and the actual connection.
 */
export function makeGuardedLookup(policy: UrlPolicy, port: () => string) {
  return (hostname: string, options: dns.LookupOptions, callback: LookupCb) => {
    dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err, "", 4);
      const list = addresses as dns.LookupAddress[];
      const allowed = policy.allowlist.has(`${hostname.toLowerCase()}:${port()}`);
      if (!allowed && list.some((a) => isBlockedAddress(a.address))) {
        const e = new BlockedUrlError(
          `${hostname} resolves to a blocked address`,
        ) as unknown as NodeJS.ErrnoException;
        e.code = "EBLOCKED";
        return callback(e, "", 4);
      }
      if (options.all) return callback(null, list);
      const first = list[0];
      if (!first) return callback(new Error("No address") as NodeJS.ErrnoException, "", 4);
      return callback(null, first.address, first.family);
    });
  };
}
