/** Money is stored in paise (bigint). Convert only at the edge, for display. */
export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  return "₹" + (Number.isInteger(rupees) ? rupees.toLocaleString("en-IN") : rupees.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
}

export function perCreditPaise(pricePaise: number, credits: number): number {
  return pricePaise / credits;
}
