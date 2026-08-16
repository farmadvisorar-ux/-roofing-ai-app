import { Suspense } from "react";
import type { Metadata } from "next";
import ArViewer from "@/components/ArViewer";

export const metadata: Metadata = {
  title: "AR preview | RoofAI Sheds",
};

export default function ArPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-300">
          Loading…
        </div>
      }
    >
      <ArViewer />
    </Suspense>
  );
}
