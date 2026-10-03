import type { DailyPlan } from "@/lib/fantrax/daily-plan";
import type { SalaryUsage } from "@/lib/fantrax/salary-cap";
import { capFitLine, salaryLine } from "@/lib/fantrax/salary-copy";

/**
 * The cap line under the legality one (a salary-cap league's plan only), and
 * the stash / call-up advice that keeps the counted roster within the cap and
 * the floor (`plan.capFit`) when it gains something. Its own chunk, with its
 * words (salary-copy.ts): a league without a cap never renders it, so its
 * tabs never load it.
 */
export function SalaryLineNote({
  salary,
  capFit,
  name,
}: {
  salary: SalaryUsage;
  capFit?: DailyPlan["capFit"];
  name: (id: string) => string;
}) {
  return (
    <>
      <p
        className={`mt-2 rounded-xl px-4 py-2 text-sm ${
          salary.over
            ? "border border-amber-500/40 bg-amber-500/10 text-amber-100"
            : "border border-white/10 bg-white/[0.03] text-slate-200"
        }`}
      >
        {salaryLine(salary)}
      </p>
      {capFit ? (
        <p
          className="mt-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-100"
          title="Meilleur alignement quotidien d’ici la fin de la saison régulière, sous le plafond et au-dessus du plancher (projections, pas une garantie)"
        >
          {capFitLine(capFit, name)}
        </p>
      ) : null}
    </>
  );
}
