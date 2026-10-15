import { HomeScreen } from "@/components/app/home-screen";
import { publicCapabilities } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function Home() {
  return <HomeScreen capabilities={publicCapabilities()} />;
}
