import type { PointTransactionItem } from "./points";

export interface AdminPointUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  balance: number;
  totalEarned: number;
  createdAt: number;
}

export interface AdminPointAction extends PointTransactionItem {
  targetName: string;
  operatorName: string | null;
}

export interface AdminPointsResponse {
  users: AdminPointUser[];
  recentActions: AdminPointAction[];
}
