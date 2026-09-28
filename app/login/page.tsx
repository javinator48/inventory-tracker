export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <form method="POST" action="/api/login" className="flex w-full max-w-xs flex-col gap-3 rounded-3xl bg-surface p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Inventory</h1>
        <input
          type="password"
          name="password"
          placeholder="Password"
          autoFocus
          required
          className="rounded-xl border border-border bg-surface px-3 py-2.5 text-base outline-none focus:border-accent"
        />
        {error && <p className="text-sm text-bad">Wrong password.</p>}
        <button className="h-11 rounded-xl bg-accent text-sm font-medium text-accent-fg">Sign in</button>
      </form>
    </main>
  );
}
