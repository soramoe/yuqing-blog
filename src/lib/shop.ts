export interface ShopItem {
  id: string;
  name: string;
  description: string;
  coverUrl: string | null;
  pricePoints: number;
  stock: number;
  perUserLimit: number;
  deliveryNote: string;
  active: boolean;
  sortOrder: number;
  redeemedByUser?: number;
}

export interface ShopOrder {
  id: string;
  itemId: string;
  itemName: string;
  itemDescription: string;
  deliveryNote: string;
  quantity: number;
  unitPrice: number;
  totalPoints: number;
  status: "pending" | "fulfilled" | "cancelled";
  createdAt: number;
  completedAt: number | null;
}

export interface ShopResponse {
  items: ShopItem[];
  user: {
    balance: number;
    totalEarned: number;
    orders: ShopOrder[];
  } | null;
}

export interface AdminShopResponse {
  items: ShopItem[];
  orders: Array<ShopOrder & {
    userId: string;
    userName: string;
    userEmail: string;
  }>;
  codes: Array<{
    id: string;
    codeHint: string;
    amount: number;
    batchId: string;
    createdAt: number;
    redeemedAt: number | null;
    redeemedByName: string | null;
  }>;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeRedemptionCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function generateRedemptionCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const characters = Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]);
  const groups = characters.join("").match(/.{1,4}/g) ?? [];
  return `YQ-${groups.join("-")}`;
}

export function maskRedemptionCode(code: string) {
  const normalized = normalizeRedemptionCode(code);
  return `${normalized.slice(0, 4)}••••${normalized.slice(-4)}`;
}

export async function hashRedemptionCode(code: string) {
  const normalized = normalizeRedemptionCode(code);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
