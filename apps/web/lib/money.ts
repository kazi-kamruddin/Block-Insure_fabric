// One display format for taka amounts held in minor units (poisha), matching
// the en-BD currency format used across the dashboards: "BDT 150,000.00".
const grouped = new Intl.NumberFormat("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatBdt(minor: number) {
  return `BDT ${grouped.format(minor / 100)}`;
}
