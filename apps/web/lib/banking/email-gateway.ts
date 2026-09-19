import "server-only";

export type OtpDelivery = { adapter: "demo" | "email-gateway"; recipient: string; messageId?: string };
export type EmailDelivery = OtpDelivery;

async function deliverTemplate(input: { recipient: string; template: string; variables: Record<string, string | number | boolean> }): Promise<EmailDelivery> {
  const gatewayUrl = process.env.EMAIL_GATEWAY_URL?.trim();
  if (!gatewayUrl) {
    if (process.env.ENABLE_DEMO_AUTH !== "true") throw new Error("EMAIL_GATEWAY_URL is required outside demo mode");
    return { adapter: "demo", recipient: input.recipient };
  }
  const response = await fetch(gatewayUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.EMAIL_GATEWAY_TOKEN ? { authorization: `Bearer ${process.env.EMAIL_GATEWAY_TOKEN}` } : {}),
    },
    body: JSON.stringify({ to: input.recipient, template: input.template, variables: input.variables }),
  });
  if (!response.ok) throw new Error(`Email gateway rejected ${input.template} delivery (${response.status})`);
  const result = await response.json().catch(() => ({})) as { messageId?: string };
  return { adapter: "email-gateway", recipient: input.recipient, messageId: result.messageId };
}

export async function deliverBankOtp(input: { recipient: string; code: string; expiresAt: number; policyId: string }) : Promise<OtpDelivery> {
  return deliverTemplate({
    recipient: input.recipient,
    template: "bank-premium-otp",
    variables: { code: input.code, policyId: input.policyId, expiresAt: new Date(input.expiresAt).toISOString() },
  });
}

export function deliverBankCommunication(input: { recipient: string; template: string; variables: Record<string, string | number | boolean> }) {
  return deliverTemplate(input);
}
