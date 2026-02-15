/**
 * Centralized Pro tier configuration.
 * Update prices here — they propagate to the setup wizard, sidebar carousel,
 * and any other component that references them.
 *
 * Prices must match GitHub Sponsors tiers (USD).
 */

export const SPONSOR_URL = "https://github.com/sponsors/alexiokay";
export const VORTIDECK_URL = "https://vortideck.com";

export interface ProTier {
  id: string;
  label: string;
  price: string;
  description: string;
  icon: string;
  color: string;
  borderClass: string;
  bgClass: string;
}

export const PRO_TIERS: ProTier[] = [
  {
    id: "pro-pack",
    label: "Pro Pack",
    price: "$55",
    description: "Docker, auto-config & priority support",
    icon: "i-lucide-sparkles",
    color: "warning",
    borderClass: "border-amber-500/30",
    bgClass: "bg-amber-500/5 hover:bg-amber-500/10",
  },
  {
    id: "installation",
    label: "Installation Service",
    price: "$220",
    description: "Remote setup via AnyDesk",
    icon: "i-lucide-headset",
    color: "purple",
    borderClass: "border-purple-500/30",
    bgClass: "bg-purple-500/5 hover:bg-purple-500/10",
  },
];
