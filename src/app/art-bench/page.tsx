import { ART } from "@/lib/data/art-manifest";

/** Temporary contact sheet for art direction review — removed before ship. */
export default function ArtBench() {
  return (
    <main className="container-page py-10">
      <h1 className="mb-6 font-display text-2xl text-ink">Art bench — {ART.length} renders</h1>
      <div className="grid grid-cols-3 gap-3">
        {ART.map((image) => (
          <figure key={image.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.src}
              alt={image.alt}
              className="aspect-[16/10] w-full rounded-lg object-cover"
            />
            <figcaption className="mt-1 font-mono text-[10px] text-stone">
              {image.id} · {image.kind}
            </figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}
