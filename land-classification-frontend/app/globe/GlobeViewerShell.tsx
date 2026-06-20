"use client";

import { useSearchParams } from "next/navigation";
import GlobeViewer from "../components/GlobeViewer";

export default function GlobeViewerShell() {
  const searchParams = useSearchParams();
  const taskId = searchParams?.get("task_id") || undefined;

  return <GlobeViewer taskId={taskId} />;
}
