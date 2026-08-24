import Link from "next/link";
import { Wordmark } from "@/components/brand/logo";
import { MiniPlayer } from "@/components/player/mini-player";
import { artById } from "@/lib/data/art-manifest";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,44%)]">
      {/* Form side */}
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Link href="/" aria-label="Back to Vizora home" className="w-fit">
          <Wordmark />
        </Link>
        <div className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        <p className="text-[13px] text-faint">
          Real-estate marketing videos in 5 minutes.
        </p>
      </div>

      {/* Identity side */}
      <div className="relative hidden overflow-hidden border-s border-seam lg:block">
        <MiniPlayer
          scenes={[
            { src: artById("azure-exterior").src, alt: "", caption: "Discover a new way of living.", motion: "push" },
            { src: artById("park-penthouse").src, alt: "", caption: "An address that speaks quietly.", motion: "pan-right" },
            { src: artById("marina-villa").src, alt: "", caption: "Sunsets included.", motion: "rise" },
            { src: artById("grove-aerial").src, alt: "", caption: "From vision to structure.", motion: "pan-left" },
          ]}
          aspect="16:9"
          sceneDurationMs={4200}
          progress={false}
          captions={false}
          className="!aspect-auto h-full"
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ground/90 to-transparent p-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-stone">
            Sample properties · rendered with Vizora
          </p>
          <p className="mt-2 max-w-sm font-display text-xl font-medium tracking-tight text-ivory">
            Every video here started as a handful of still images.
          </p>
        </div>
      </div>
    </div>
  );
}
