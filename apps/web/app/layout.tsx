import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Block-Insure Fabric",
  description: "Permissioned insurance workflows on Hyperledger Fabric",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className="dark"
      data-theme="dark"
      style={{ colorScheme: "dark" }}
      suppressHydrationWarning
    >
      <head>
        <meta name="theme-color" content="#040805" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem("block-insure-theme")!=="light")return;var d=document.documentElement;d.classList.remove("dark");d.classList.add("light");d.setAttribute("data-theme","light");d.style.colorScheme="light";}catch{}})();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
