export type CustomerView = {
  memberId: string;
  email: string;
  fullName?: string;
  phone?: string;
  dateOfBirth?: string;
  address?: string;
  consent?: { dataSharing: boolean; at: string };
  status: "EMAIL_VERIFIED" | "PENDING_KYC" | "ACTIVE" | "REJECTED" | "SUSPENDED";
  nidLast3?: string;
};

export type CodeResponse = { message?: string; displayCode?: string };

export async function customerApi<T>(url: string, input?: object): Promise<T> {
  const response = await fetch(url, input
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }
    : { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    throw new Error(data?.message ?? data?.error ?? "The request could not be completed. Please try again.");
  }
  return data as T;
}
