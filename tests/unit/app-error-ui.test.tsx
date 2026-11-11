import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AppError from "@/app/error";

describe("shared error recovery screen", () => {
  it("offers retry and dashboard actions without exposing technical details", () => {
    const error = new Error("Internal database query and private connection details");
    const html = renderToStaticMarkup(<AppError error={error} retry={vi.fn()} />);
    expect(html).toContain("This page could not load");
    expect(html).toContain("Try again");
    expect(html).toContain('href="/dashboard"');
    expect(html).not.toContain(error.message);
  });
});
