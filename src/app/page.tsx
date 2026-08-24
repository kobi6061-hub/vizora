import { Wordmark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

/** Temporary foundation bench — replaced by the marketing homepage in Phase 3. */
export default function Home() {
  return (
    <main className="container-page flex min-h-dvh flex-col justify-center gap-10 py-16">
      <Wordmark />
      <h1 className="text-display text-5xl text-ink md:text-7xl">
        Turn property images into marketing videos —{" "}
        <em className="text-serif-accent">in 5 minutes.</em>
      </h1>
      <p className="max-w-xl text-lg text-stone">
        Upload your renders, photos or property visuals. Vizora transforms them
        into polished real-estate videos, ready to publish.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg">Create your video</Button>
        <Button size="lg" variant="outline">
          Watch an example
        </Button>
        <Button size="lg" variant="ghost">
          Ghost
        </Button>
        <Button size="lg" variant="print">
          Print
        </Button>
      </div>
      <p className="text-eyebrow">Upload → Create → Publish</p>
      <div className="flex gap-2">
        {["ground", "surface", "raised", "seam", "stone", "signal"].map((token) => (
          <div
            key={token}
            className="flex h-16 w-24 items-end rounded-lg border border-seam p-2 text-[10px] text-stone"
            style={{ background: `var(--color-${token})` }}
          >
            {token}
          </div>
        ))}
      </div>
    </main>
  );
}
