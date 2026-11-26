import { CustomerAccessPage } from "@/components/customer-access-page";

export const dynamic = "force-dynamic";

export default function SigninPage() {
  return <CustomerAccessPage mode="login" />;
}
