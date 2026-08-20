export default function AppLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading page"
      className="mx-auto min-h-screen max-w-6xl px-5 py-10 sm:px-6"
    >
      <div className="h-3 w-28 animate-pulse rounded bg-slate-200" />
      <div className="mt-3 h-9 w-64 max-w-full animate-pulse rounded bg-slate-200" />
      <div className="mt-3 h-4 w-96 max-w-full animate-pulse rounded bg-slate-100" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            className="h-24 animate-pulse rounded-md ui-panel border border-slate-200 bg-white"
            key={index}
          />
        ))}
      </div>
    </main>
  );
}
