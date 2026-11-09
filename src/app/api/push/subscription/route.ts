import { handlePushRequest } from "@/lib/push-api";
export const runtime = "nodejs";
export const maxDuration = 30;
export const GET = (request: Request) => handlePushRequest(request);
export const DELETE = (request: Request) => handlePushRequest(request);
export const POST = (request: Request) => handlePushRequest(request);
