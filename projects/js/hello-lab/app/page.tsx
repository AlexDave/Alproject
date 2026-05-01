export default function HelloLabPage() {
  return (
    <main className="hl-mx-auto hl-flex hl-min-h-screen hl-max-w-xl hl-flex-col hl-justify-center hl-px-6 hl-py-12">
      <p className="hl-mb-2 hl-text-sm hl-font-medium hl-tracking-wide hl-text-emerald-400">
        projects/js/hello-lab
      </p>
      <h1 className="hl-mb-4 hl-text-3xl hl-font-semibold hl-tracking-tight">Hello Lab</h1>
      <p className="hl-mb-8 hl-text-slate-400">
        Изолированное Next.js-приложение с Tailwind и префиксом <code className="hl-rounded hl-bg-slate-800 hl-px-1.5 hl-py-0.5 hl-text-sm hl-text-emerald-300">hl-</code>
        . Открыто с карточки на портале.
      </p>
      <a
        className="hl-inline-flex hl-w-fit hl-items-center hl-rounded-md hl-bg-emerald-500 hl-px-4 hl-py-2 hl-text-sm hl-font-medium hl-text-slate-950 hover:hl-bg-emerald-400"
        href="http://localhost:3000"
      >
        На портал
      </a>
    </main>
  );
}
