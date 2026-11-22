export interface CampaignCode {
  id: string;
  name: string;
  code: string;
  amount: number;
  maxRedemptions: number | null;
  redeemedCount: number;
  active: boolean;
  startsAt: number | null;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function normalizeCampaignCode(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("zh-CN");
}
