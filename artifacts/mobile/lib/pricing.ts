export function getYearlySavings(
  monthlyPrice: number | undefined,
  yearlyPrice: number | undefined,
): { percent: number; monthsFree: number } | null {
  if (!monthlyPrice || !yearlyPrice || monthlyPrice <= 0) return null;
  const fullYear = monthlyPrice * 12;
  if (yearlyPrice >= fullYear) return null;
  const percent = Math.round(((fullYear - yearlyPrice) / fullYear) * 100);
  const monthsFree = Math.round((fullYear - yearlyPrice) / monthlyPrice);
  return { percent, monthsFree };
}
