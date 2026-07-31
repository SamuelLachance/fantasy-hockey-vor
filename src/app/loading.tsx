import { RankingsLoadingStatus } from "@/components/RankingsLoadingStatus";

export default function Loading() {
  return (
    <main className="flex min-h-[40vh] flex-col items-center justify-center px-4 py-20">
      <RankingsLoadingStatus />
    </main>
  );
}
