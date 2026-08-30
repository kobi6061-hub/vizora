"use client";

import * as React from "react";
import { CloudUpload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { AssetThumb, useUploadAssets } from "@/components/studio/upload-zone";
import { VIDEO_STYLES } from "@/lib/data/video-styles";
import { useAssetUrlOf } from "@/lib/hooks/use-asset-url";
import type { BrandKit, VideoStyleId } from "@/lib/domain/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn } from "@/lib/utils";

const FONT_OPTIONS: { id: BrandKit["fontPreference"]; label: string; hint: string }[] = [
  { id: "modern", label: "Modern", hint: "Clean grotesque — the Vizora default" },
  { id: "editorial", label: "Editorial", hint: "Serif accents for premium listings" },
  { id: "technical", label: "Technical", hint: "Mono details for developments" },
];

export function BrandKitView() {
  const brandKit = useWorkspaceStore((state) => state.brandKit);
  const updateBrandKit = useWorkspaceStore((state) => state.updateBrandKit);
  const assets = useWorkspaceStore((state) => state.assets);
  const { upload, uploading } = useUploadAssets();
  const { toast } = useToast();
  const logoInputRef = React.useRef<HTMLInputElement>(null);

  const [draft, setDraft] = React.useState<BrandKit>(brandKit);
  const [saving, setSaving] = React.useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(brandKit);

  // Adopt store changes (e.g. logo upload) into the draft at render time.
  const [lastLogoFromStore, setLastLogoFromStore] = React.useState(brandKit.logoAssetId);
  if (brandKit.logoAssetId !== lastLogoFromStore) {
    setLastLogoFromStore(brandKit.logoAssetId);
    setDraft((d) => ({ ...d, logoAssetId: brandKit.logoAssetId }));
  }

  const logoAsset = draft.logoAssetId
    ? assets.find((asset) => asset.id === draft.logoAssetId) ?? null
    : null;
  const logoUrl = useAssetUrlOf(logoAsset);

  const patch = (value: Partial<BrandKit>) => setDraft((d) => ({ ...d, ...value }));

  const save = async () => {
    setSaving(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    updateBrandKit(draft);
    setSaving(false);
    toast({
      title: "Brand kit saved",
      description: "New projects pick it up automatically.",
    });
  };

  return (
    <div className="container-page max-w-6xl space-y-8 py-8 lg:py-10">
      <PageHeader
        title="Brand Kit"
        description="Set once — every new video carries your brand."
        actions={
          <Button onClick={save} disabled={!dirty} loading={saving}>
            {saving ? "Saving…" : "Save brand kit"}
          </Button>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[1fr_400px]">
        {/* Form */}
        <div className="space-y-6">
          <section className="rounded-2xl border border-seam bg-surface/40 p-6">
            <h2 className="text-[13px] font-medium uppercase tracking-wider text-stone">Identity</h2>
            <div className="mt-5 space-y-5">
              <div>
                <p className="mb-2 text-[13px] font-medium text-ink-mid">Company logo</p>
                {logoAsset ? (
                  <div className="flex items-center gap-3 rounded-xl border border-seam bg-raised p-3">
                    <div className="flex h-12 w-20 items-center justify-center overflow-hidden rounded-md bg-ground p-1.5">
                      <AssetThumb asset={logoAsset} className="max-h-full max-w-full object-contain" />
                    </div>
                    <p className="min-w-0 flex-1 truncate text-[13px] text-ink-mid">{logoAsset.name}</p>
                    <button
                      aria-label="Remove logo"
                      onClick={() => patch({ logoAssetId: null })}
                      className="rounded-md p-1.5 text-faint transition-colors hover:bg-overlay hover:text-danger"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-seam-strong px-4 py-6 text-[13px] text-stone transition-colors hover:border-faint hover:text-ink"
                  >
                    <CloudUpload className="size-4" aria-hidden />
                    {uploading.length > 0 ? "Uploading…" : "Upload logo (PNG or SVG)"}
                  </button>
                )}
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/svg+xml,image/webp"
                  className="sr-only"
                  onChange={(event) => {
                    if (event.target.files?.length) {
                      void upload(
                        event.target.files,
                        (added) => patch({ logoAssetId: added[0]?.id ?? null }),
                        "logo",
                      );
                    }
                    event.target.value = "";
                  }}
                />
              </div>
              <Field label="Brand name" htmlFor="kit-name">
                <Input
                  id="kit-name"
                  value={draft.brandName}
                  onChange={(event) => patch({ brandName: event.target.value })}
                  placeholder="e.g. Northview Estates"
                />
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Primary brand style" htmlFor="kit-style">
                  <Select
                    value={draft.brandStyle}
                    onValueChange={(value) => patch({ brandStyle: value as VideoStyleId })}
                  >
                    <SelectTrigger id="kit-style">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VIDEO_STYLES.map((style) => (
                        <SelectItem key={style.id} value={style.id}>
                          {style.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <div>
                  <p className="mb-1.5 text-[13px] font-medium text-ink-mid">Font preference</p>
                  <div className="flex gap-1.5">
                    {FONT_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        onClick={() => patch({ fontPreference: option.id })}
                        aria-pressed={draft.fontPreference === option.id}
                        title={option.hint}
                        className={cn(
                          "flex-1 rounded-lg border px-2 py-2 text-[12px] font-medium transition-colors",
                          draft.fontPreference === option.id
                            ? "border-signal bg-raised text-ink"
                            : "border-seam bg-raised/50 text-stone hover:border-seam-strong",
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-seam bg-surface/40 p-6">
            <h2 className="text-[13px] font-medium uppercase tracking-wider text-stone">
              Contact & call to action
            </h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <Field label="Default call to action" htmlFor="kit-cta">
                <Input
                  id="kit-cta"
                  value={draft.defaultCta}
                  onChange={(event) => patch({ defaultCta: event.target.value })}
                  placeholder="e.g. Book a viewing"
                />
              </Field>
              <Field label="End card line" htmlFor="kit-endcard">
                <Input
                  id="kit-endcard"
                  value={draft.endCardText}
                  onChange={(event) => patch({ endCardText: event.target.value })}
                  placeholder="e.g. Your next address awaits."
                />
              </Field>
              <Field label="Website" htmlFor="kit-website">
                <Input
                  id="kit-website"
                  value={draft.website}
                  onChange={(event) => patch({ website: event.target.value })}
                  placeholder="yourbrand.com"
                />
              </Field>
              <Field label="Phone" htmlFor="kit-phone">
                <Input
                  id="kit-phone"
                  value={draft.phone}
                  onChange={(event) => patch({ phone: event.target.value })}
                  placeholder="+357 25 000 000"
                />
              </Field>
            </div>
          </section>
        </div>

        {/* Live end-card preview */}
        <div className="lg:sticky lg:top-8 lg:self-start">
          <p className="text-eyebrow mb-3">End card preview</p>
          <div className="flex aspect-video flex-col items-center justify-center gap-3.5 overflow-hidden rounded-2xl border border-seam-strong bg-ground px-6 text-center shadow-panel">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="max-h-12 max-w-32 object-contain" />
            ) : (
              <p
                className={cn(
                  "text-2xl font-medium tracking-tight text-ivory",
                  draft.fontPreference === "editorial" ? "text-serif-accent" : "font-display",
                )}
              >
                {draft.brandName || "Your brand"}
              </p>
            )}
            <span className="rounded-full bg-ivory px-4 py-1.5 text-[13px] font-semibold text-ground">
              {draft.defaultCta || "Book a viewing"}
            </span>
            {(draft.phone || draft.website) && (
              <p className="font-mono text-[10px] tracking-wide text-stone">
                {[draft.phone, draft.website].filter(Boolean).join(" · ")}
              </p>
            )}
            <p className="mt-1 max-w-56 text-[11px] italic leading-snug text-faint">
              {draft.endCardText || "Your next address awaits."}
            </p>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-faint">
            This card closes every video. Individual projects can override any
            of it in the studio&apos;s Brand panel.
          </p>
        </div>
      </div>
    </div>
  );
}
