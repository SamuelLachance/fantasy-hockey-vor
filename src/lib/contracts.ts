import { parseBirthDate } from "./age";
import type { ContractInfo } from "./profile-types";

interface CapWagesPlayer {
  nhlId?: number;
  born?: string;
  yearsRemaining?: string;
  terms?: string;
  contracts?: Array<{
    type?: string;
    length?: string;
    value?: string;
    expiryStatus?: string;
    details?: Array<{
      season?: string;
      capHit?: string;
      aav?: string;
    }>;
  }>;
}

function parseMoney(raw?: string): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseYearsRemaining(raw?: string): number | null {
  if (!raw) return null;
  const m = raw.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function nameToSlug(first: string, last: string): string {
  return `${first}-${last}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildContractInfo(player: CapWagesPlayer): ContractInfo {
  const active = player.contracts?.[0];
  const seasonDetail =
    active?.details?.find((d) => d.season?.includes("2026")) ??
    active?.details?.[0];

  const capHitUsd =
    parseMoney(seasonDetail?.capHit) ?? parseMoney(active?.value);
  const aavUsd = parseMoney(seasonDetail?.aav) ?? capHitUsd;
  const yearsRemaining = parseYearsRemaining(player.yearsRemaining);
  const expiryStatus = active?.expiryStatus ?? player.yearsRemaining ?? null;
  const contractType = active?.type ?? player.terms ?? null;

  const capFmt =
    capHitUsd != null
      ? `$${(capHitUsd / 1_000_000).toFixed(2)}M`
      : "unknown cap hit";
  const yearsFmt =
    yearsRemaining != null
      ? `${yearsRemaining} year${yearsRemaining === 1 ? "" : "s"} remaining`
      : "term unknown";

  return {
    capHitUsd,
    aavUsd,
    yearsRemaining,
    expiryStatus,
    contractType,
    birthDate: parseBirthDate(player.born ?? "") ?? undefined,
    source: "capwages",
    summary: `${capFmt} cap hit, ${yearsFmt}${expiryStatus ? ` (${expiryStatus})` : ""}`,
  };
}

const EMPTY_CONTRACT: ContractInfo = {
  capHitUsd: null,
  aavUsd: null,
  yearsRemaining: null,
  expiryStatus: null,
  contractType: null,
  source: "unavailable",
  summary: "Contract data unavailable",
};

export async function fetchContractByNhlId(
  nhlId: number,
  firstName: string,
  lastName: string,
): Promise<ContractInfo> {
  const slug = nameToSlug(firstName, lastName);
  const urls = [
    `https://capwages.com/players/${slug}`,
    `https://capwages.com/players/${lastName.toLowerCase()}-${firstName.toLowerCase()}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "text/html" },
      });
      if (!res.ok) continue;

      const html = await res.text();
      const marker = "__NEXT_DATA__";
      const start = html.indexOf(marker);
      if (start < 0) continue;

      const jsonStart = html.indexOf(">", start) + 1;
      const jsonEnd = html.indexOf("</script>", jsonStart);
      const data = JSON.parse(html.slice(jsonStart, jsonEnd)) as {
        props?: { pageProps?: { player?: CapWagesPlayer } };
      };

      const player = data.props?.pageProps?.player;
      if (!player) continue;
      if (player.nhlId && player.nhlId !== nhlId) continue;

      return buildContractInfo(player);
    } catch {
      continue;
    }
  }

  return EMPTY_CONTRACT;
}

export function formatCapHit(usd: number | null): string {
  if (usd == null) return "N/A";
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  return `$${usd.toLocaleString()}`;
}
