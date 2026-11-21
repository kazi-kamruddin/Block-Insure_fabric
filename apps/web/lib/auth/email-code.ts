import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { customerStateRoot } from "@/lib/customers/settings";
import { readJson, serialized, writeJson } from "@/lib/customers/state-file";

const hour = 3_600_000;
const resend = 60_000;
const ttl = 600_000;
const challenge = z.object({ digest: z.string(), expiresAt: z.number(), attempts: z.number() });
const stateSchema = z.object({
  challenges: z.record(z.string(), challenge),
  emailSends: z.record(z.string(), z.array(z.number())),
  ipSends: z.record(z.string(), z.array(z.number())),
});

export type EmailCodePurpose = "signup" | "login" | `email-change:${string}`;

export class EmailCodeStore {
  private readonly file: string;
  constructor(private readonly secret: string, root = customerStateRoot()) {
    if (secret.length < 32) throw new Error("Email code key is unavailable");
    this.file = path.join(root, "customer-email-codes.json");
  }

  private digest(...parts: string[]) {
    return createHmac("sha256", this.secret).update(JSON.stringify(["customer-email-code-v1", ...parts])).digest("hex");
  }

  private async load() {
    return stateSchema.parse(await readJson(this.file, { challenges: {}, emailSends: {}, ipSends: {} }));
  }

  async issue(email: string, ip: string, purpose: EmailCodePurpose, now = Date.now()) {
    return serialized(this.file, async () => {
      const state = await this.load();
      for (const [key, value] of Object.entries(state.challenges)) {
        if (value.expiresAt <= now) delete state.challenges[key];
      }
      for (const sends of [state.emailSends, state.ipSends]) {
        for (const [key, times] of Object.entries(sends)) {
          const recent = times.filter(time => time > now - hour);
          if (recent.length) sends[key] = recent;
          else delete sends[key];
        }
      }
      const emailKey = this.digest("email", email);
      const ipKey = this.digest("ip", ip);
      const emails = state.emailSends[emailKey] ?? [];
      const ips = state.ipSends[ipKey] ?? [];
      const retryAt = Math.max(
        (emails.at(-1) ?? -resend) + resend,
        emails.length >= 5 ? emails[0] + hour : 0,
        ips.length >= 20 ? ips[0] + hour : 0,
      );
      if (retryAt > now) return { retryAfter: Math.ceil((retryAt - now) / 1000) } as const;

      const code = randomInt(1_000_000).toString().padStart(6, "0");
      const expiresAt = now + ttl;
      state.emailSends[emailKey] = [...emails, now];
      state.ipSends[ipKey] = [...ips, now];
      state.challenges[this.digest("challenge", purpose, email)] = {
        digest: this.digest("code", purpose, email, String(expiresAt), code), expiresAt, attempts: 0,
      };
      await writeJson(this.file, state);
      return { code, expiresAt } as const;
    });
  }

  async consume(email: string, purpose: EmailCodePurpose, code: string, now = Date.now()) {
    return serialized(this.file, async () => {
      const state = await this.load();
      const key = this.digest("challenge", purpose, email);
      const record = state.challenges[key];
      if (!record) return false;
      const expected = Buffer.from(record.digest, "hex");
      const supplied = Buffer.from(this.digest("code", purpose, email, String(record.expiresAt), code), "hex");
      const accepted = now < record.expiresAt && timingSafeEqual(expected, supplied);
      record.attempts++;
      if (accepted || record.expiresAt <= now || record.attempts >= 5) delete state.challenges[key];
      await writeJson(this.file, state);
      return accepted;
    });
  }
}
