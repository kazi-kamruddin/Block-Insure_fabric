import type { WorkspaceIcon } from "@/lib/workspace/sections";

// Small stroke icons for the workspace sidebar (24px grid, currentColor).
const paths: Record<WorkspaceIcon, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  claims: "M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M9 13h6M9 17h4",
  customers: "M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.15a3.5 3.5 0 0 1 0 6.7",
  products: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  partners: "M3 21h18M5 21V8l7-4 7 4v13M9 21v-5h6v5M9 11h.01M15 11h.01",
  premiums: "M12 3v18M16.5 7.5c-.6-1.4-2.3-2.5-4.5-2.5-2.8 0-4.5 1.5-4.5 3.4C7.5 13 16.5 11 16.5 15.6c0 1.9-1.7 3.4-4.5 3.4-2.3 0-4-1.1-4.6-2.6",
  verification: "M12 3 4 6v6c0 4.6 3.4 8.3 8 9 4.6-.7 8-4.4 8-9V6zM8.5 12l2.5 2.5 4.5-5",
  evidence: "M12 3a4 4 0 0 0-4 4v3h8V7a4 4 0 0 0-4-4zM6 10h12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM12 14v3",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  reports: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  tools: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z",
  policies: "M12 3 4 6v6c0 4.6 3.4 8.3 8 9 4.6-.7 8-4.4 8-9V6z",
  payments: "M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM2 10h20M6 15h4",
  documents: "M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  intake: "M9 3h6v4H9zM7 5H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2M12 11v6M9 14h6",
  registry: "M4 5h16M4 12h16M4 19h16M8 3v4M14 10v4M10 17v4",
  records: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5",
  accounts: "M3 10 12 4l9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18",
  collections: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3",
  payouts: "M12 21V9M7 14l5-5 5 5M4 3h16",
  notifications: "M6 9a6 6 0 1 1 12 0c0 6 3 7 3 7H3s3-1 3-7M10 20a2 2 0 0 0 4 0",
  reviews: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9",
};

export function WorkspaceIconGlyph({ name }: { name: WorkspaceIcon }) {
  return (
    <svg className="sidebarIcon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  );
}
