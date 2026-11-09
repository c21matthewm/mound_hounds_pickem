import { createResultsAutomationHandler } from "@/lib/results-automation-handler";

export const runtime = "nodejs";
export const maxDuration = 60;
export const POST = createResultsAutomationHandler();
