import { Suspense } from "react";
import ResultsImagesShell from "./ResultsImagesShell";

export default function ResultsImagesPage() {
  return (
    <Suspense fallback={<div className="p-6">جارٍ تحميل صور المهمة…</div>}>
      <ResultsImagesShell />
    </Suspense>
  );
}
