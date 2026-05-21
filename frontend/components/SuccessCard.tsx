"use client";

interface Props {
  beforeStatus: string;
  afterStatus: string;
  propertyTitle: string;
  bound: number;
}

export function SuccessCard({
  beforeStatus,
  afterStatus,
  propertyTitle,
  bound,
}: Props) {
  return (
    <div className="rounded border border-line bg-paper">
      <div className="border-b border-line px-4 py-2 text-[12px] font-medium uppercase tracking-wider text-ink-500">
        Before / after
      </div>
      <table className="w-full text-[13.5px]">
        <tbody>
          <Row label="Before" value={beforeStatus} property={propertyTitle} tone="bad" />
          <Row label="After" value={afterStatus} property={propertyTitle} tone="ok" />
        </tbody>
      </table>
      <div className="border-t border-line px-4 py-2 text-[12px] text-ink-500">
        No counterexample found up to {bound} transitions.
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  property,
  tone,
}: {
  label: string;
  value: string;
  property: string;
  tone: "ok" | "bad";
}) {
  return (
    <tr className="border-b border-line last:border-b-0">
      <td className="w-20 px-4 py-2 text-ink-400">{label}</td>
      <td className="px-2 py-2 text-ink-800">{property}</td>
      <td className="w-28 px-4 py-2 text-right font-mono text-[12.5px]">
        <span className={tone === "ok" ? "text-emerald-700" : "text-red-700"}>
          {value}
        </span>
      </td>
    </tr>
  );
}
