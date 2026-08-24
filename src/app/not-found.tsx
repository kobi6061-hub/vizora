import Link from "next/link";
import { Wordmark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Wordmark />
      <p className="text-eyebrow mt-10">404</p>
      <h1 className="text-display mt-4 max-w-md text-4xl text-ink">
        This address doesn&apos;t exist — <em className="text-serif-accent">yet.</em>
      </h1>
      <p className="mt-4 max-w-sm text-[15px] text-stone">
        The page you&apos;re looking for was moved, renamed, or never built.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/">
          <Button size="lg">Back to Vizora</Button>
        </Link>
        <Link href="/app">
          <Button size="lg" variant="outline">
            Open the studio
          </Button>
        </Link>
      </div>
    </main>
  );
}
