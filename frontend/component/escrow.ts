
export type EscrowMilestone = {
  title?: string;
  description?: string;
  amount: string | number;
  status?: string;
  dueDate?: string | null;
};

export type Escrow = {
  id: string;
  dealId?: number | string;
  title: string;
  counterparty: string;
  amount: string;
  token: string;
  status: string;
  milestones: EscrowMilestone[];
  milestoneCount: number;
  createdAt?: string;
  documentUrl?: string | null;
  payerDocumentUrl?: string | null;
  payeeDocumentUrl?: string | null;
};
