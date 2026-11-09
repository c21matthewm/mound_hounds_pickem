"""Bounded text extraction and finality verification in a disposable process; no network or file writes."""
from __future__ import annotations
import io,json,sys

def main():
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_CPU,(2,2))
        # Keep decompression/object expansion from exhausting a web worker.
        if sys.platform != "darwin": resource.setrlimit(resource.RLIMIT_AS,(256*1024*1024,256*1024*1024))
        from pypdf import PdfReader
        metadata=sys.stdin.buffer.readline(131_074)
        if len(metadata)>131_073 or not metadata.endswith(b"\n"):return 1
        metadata=json.loads(metadata)
        content=sys.stdin.buffer.read(1_048_577)
        if len(content)>1_048_576 or not content.startswith(b"%PDF-"):return 1
        doc=PdfReader(io.BytesIO(content),strict=True)
        if doc.is_encrypted or not 1<=len(doc.pages)<=4:return 1
        text="\n".join(page.extract_text() or "" for page in doc.pages)
        if len(text)>100_000:return 1
        # Verification runs inside the same CPU/memory/wall-clock boundary as PDF
        # extraction. Untrusted text never runs regex work in the FastAPI worker.
        from services.models import ResultsPayload
        from services.indycar_results_fetcher import confirm_pdf_text
        finality=confirm_pdf_text(text,ResultsPayload.model_validate(metadata["payload"]),metadata["event_name"],metadata["session_date"])
        sys.stdout.write(json.dumps({"finality":finality}));return 0
    except Exception:return 1

if __name__=="__main__":raise SystemExit(main())
