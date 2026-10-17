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
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("block-insure-theme");if(t==="light"){document.documentElement.classList.remove("dark");document.documentElement.classList.add("light");document.documentElement.setAttribute("data-theme","light");document.documentElement.style.colorScheme="light";}else{document.documentElement.classList.add("dark");document.documentElement.classList.remove("light");document.documentElement.setAttribute("data-theme","dark");document.documentElement.style.colorScheme="dark";}}catch(e){document.documentElement.classList.add("dark");document.documentElement.setAttribute("data-theme","dark");document.documentElement.style.colorScheme="dark";}})();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
