import type { Metadata } from "next";
import { HubLayout, hubMeta } from "@/components/article";

export const metadata: Metadata = hubMeta("tool");

export default function Page() {
  return <HubLayout kind="tool" />;
}
