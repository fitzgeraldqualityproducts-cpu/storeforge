import { json, route } from "@/lib/api";
import { publicCapabilities } from "@/lib/config";

export const dynamic = "force-dynamic";

export const GET = route(async () => json(publicCapabilities()));
