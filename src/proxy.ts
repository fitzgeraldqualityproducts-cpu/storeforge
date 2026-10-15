import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optional password gate for deployed instances. When APP_PASSWORD is set, every page and API
 * route asks for it through HTTP Basic auth (any username). Export image links under
 * /api/public stay open because Shopify fetches them; they carry their own token.
 */
export function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD?.trim();
  if (!password) return NextResponse.next();
  if (isAuthorized(request.headers.get("authorization"), password)) return NextResponse.next();
  return new NextResponse("Password required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="StoreForge", charset="UTF-8"' },
  });
}

function isAuthorized(header: string | null, password: string): boolean {
  if (!header?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const given = Buffer.from(decoded.slice(decoded.indexOf(":") + 1));
  const expected = Buffer.from(password);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const config = {
  matcher: ["/((?!api/public/|api/health$|_next/static|_next/image|favicon.ico).*)"],
};
