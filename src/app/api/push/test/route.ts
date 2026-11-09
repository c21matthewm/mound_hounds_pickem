import { handlePushRequest } from "@/lib/push-api";
export const runtime = "nodejs";
export const maxDuration = 30;
export const POST = (request: Request) => handlePushRequest(request,true);
