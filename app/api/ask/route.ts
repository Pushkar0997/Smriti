import { NextResponse } from "next/server";
import { executeGroundedQuery } from "@/lib/retrieval";
import { generateGroundedAnswer } from "@/lib/gemini";

export async function POST(request: Request) {
  // 1. Check ACCESS_CODE before doing anything else (per architecture.md §4b)
  const configuredAccessCode = process.env.ACCESS_CODE;
  if (!configuredAccessCode) {
    return NextResponse.json(
      { code: "SERVER_CONFIG_ERROR", message: "ACCESS_CODE not configured on server" },
      { status: 500 }
    );
  }

  // Parse request body
  let body: Record<string, unknown> | null = null;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // Extract access code from header (Authorization: Bearer <CODE> or x-access-code) or body
  const authHeader = request.headers.get("authorization");
  const customHeader = request.headers.get("x-access-code");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;
  const bodyAccessCode =
    typeof body?.accessCode === "string"
      ? body.accessCode
      : typeof body?.access_code === "string"
        ? body.access_code
        : null;

  const providedCode = customHeader || bearerToken || bodyAccessCode;

  if (!providedCode || providedCode !== configuredAccessCode) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Invalid or missing access code" },
      { status: 401 }
    );
  }

  // 2. Validate query string
  const query = body?.query;
  if (typeof query !== "string" || query.trim().length === 0) {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "Query string is required" },
      { status: 400 }
    );
  }

  try {
    // 3. Execute grounded query: retrieval -> ground-check -> LLM generation
    // Strict INV-3: never log query text to console, DB, or external systems
    const result = await executeGroundedQuery(query.trim(), generateGroundedAnswer);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal query error";
    // Log error message only — never query text (INV-3)
    console.error("Ask API execution error:", message);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message },
      { status: 500 }
    );
  }
}
