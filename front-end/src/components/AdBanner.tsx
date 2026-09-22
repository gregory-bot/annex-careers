import { useEffect, useState } from "react";
import { fileUrl, recordAdClick, recordAdImpression, usePlacementAds, type AdPlacement, type PublicAd } from "@/lib/jobStore";

/** Weighted random choice so several advertisers can share one placement. */
function pickWeighted(ads: PublicAd[]): PublicAd | null {
  if (ads.length === 0) return null;
  const total = ads.reduce((sum, ad) => sum + Math.max(1, ad.weight), 0);
  let roll = Math.random() * total;
  for (const ad of ads) {
    roll -= Math.max(1, ad.weight);
    if (roll <= 0) return ad;
  }
  return ads[ads.length - 1];
}

/**
 * A directly-sold banner for one placement. Renders nothing when no ad is
 * live there. Counts one impression per mount and a click on the way out.
 */
export default function AdBanner({ placement, variant = "wide", className = "" }: {
  placement: AdPlacement;
  variant?: "wide" | "sidebar";
  className?: string;
}) {
  const { ads } = usePlacementAds(placement);
  const [ad, setAd] = useState<PublicAd | null>(null);

  // Choose once per mount, when the ads for this placement arrive.
  useEffect(() => {
    if (!ad && ads.length > 0) setAd(pickWeighted(ads));
  }, [ads, ad]);

  useEffect(() => {
    if (ad) void recordAdImpression(ad.id);
  }, [ad?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ad) return null;

  return (
    <a
      href={ad.link_url}
      target="_blank"
      rel="noopener noreferrer sponsored"
      onClick={() => void recordAdClick(ad.id)}
      className={`group relative block overflow-hidden rounded-xl border border-border bg-card ${className}`}
      aria-label={`${ad.headline || ad.advertiser || "Advertisement"} (sponsored)`}
    >
      <img
        src={fileUrl(ad.image)}
        alt={ad.headline || ad.advertiser || "Advertisement"}
        loading="lazy"
        className={variant === "wide" ? "w-full h-auto max-h-[320px] object-cover" : "w-full h-auto object-cover"}
      />
      <span className="absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
        Sponsored
      </span>
      {ad.headline && (
        <span className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 text-sm font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
          {ad.headline}{ad.advertiser ? ` \u00b7 ${ad.advertiser}` : ""}
        </span>
      )}
    </a>
  );
}
