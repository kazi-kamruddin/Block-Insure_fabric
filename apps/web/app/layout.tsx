import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Block-Insure Fabric",
  description: "Permissioned insurance workflows on Hyperledger Fabric",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
