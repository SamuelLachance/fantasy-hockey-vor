import type { SalaryUsage } from "@/lib/fantrax/salary-cap";
import { salaryLine } from "@/lib/fantrax/salary-copy";

/**
 * The cap line under the legality one (a salary-cap league's plan only). Its
 * own chunk, with its words (salary-copy.ts): a league without a cap never
 * renders it, so its tabs never load it.
 */
export function SalaryLineNote({ salary }: { salary: SalaryUsage }) {
  return (
    <p
      className={`mt-2 rounded-xl px-4 py-2 text-sm ${
        salary.over
          ? "border border-amber-500/40 bg-amber-500/10 text-amber-100"
          : "border border-white/10 bg-white/[0.03] text-slate-200"
      }`}
    >
      {salaryLine(salary)}
    </p>
  );
}
