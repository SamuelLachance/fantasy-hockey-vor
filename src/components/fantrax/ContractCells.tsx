import type { DynastyRecord } from "@/lib/dynasty/types";
import { contractEndLabel, salaryCell, SLAPSHOT_LEGEND } from "@/lib/fantrax/contract-copy";

type Contract = NonNullable<DynastyRecord["contract"]>;

/**
 * A salary-cap league's contract cells and legend (Slapshot): their own chunk,
 * loaded by fantrax-table.tsx through next/dynamic only where a contract
 * column or the cap legend shows. Captains has neither, so its tabs never
 * load it.
 */

/** A salary cell: signed seasons plain, a projected next contract in italics (its title says so). */
export function SalaryNode({ m, contract, t }: { m: number; contract: Contract | null; t: number }) {
  const projected = !!contract && t >= contract.signed;
  if (projected && m === 0) return <span title="Sans contrat LNH : aucun salaire avant son arrivée prévue dans la LNH">—</span>;
  if (projected) {
    return (
      <span title={contract.signed === 0 ? "Sans contrat LNH : contrat d’entrée supposé" : "Contrat projeté (le sien se termine avant)"} className="italic">
        {salaryCell(m)}
      </span>
    );
  }
  return <>{salaryCell(m)}</>;
}

/** « 2031-32 · JAS » (the contract column). */
export function ContractEndNode({ contract, firstSeason }: { contract: Contract; firstSeason?: number }) {
  return <>{contractEndLabel(contract, firstSeason)}</>;
}

/** The legend of a salary-cap dynasty league (no cutdown, the cap charge inside the value). */
export function SlapshotLegend() {
  return <>{SLAPSHOT_LEGEND}</>;
}
