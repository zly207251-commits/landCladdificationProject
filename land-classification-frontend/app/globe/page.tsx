import GlobeViewerShell from "./GlobeViewerShell";
import { Suspense } from "react";

export default function GlobePage() {
  return (
    <main className="w-screen h-screen overflow-hidden bg-slate-950 p-0 m-0">
      <Suspense fallback={<div className="p-6 text-white text-center font-medium">جارٍ تحميل العارض ثلاثي الأبعاد…</div>}>
        <GlobeViewerShell />
      </Suspense>
    </main>
  );
}
