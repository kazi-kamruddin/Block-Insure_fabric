import { expect, type Page } from "@playwright/test";
import { workspaceByRole } from "../lib/auth/accounts";
import type { FabricRole } from "../lib/fabric/config";
import { sectionForOperation, sectionHref } from "../lib/workspace/sections";

// Workspaces are split into sidebar sub-pages. These helpers open the page that
// holds a card or a transaction form for the signed-in workspace.

function currentRole(page: Page): { workspace: string; role: FabricRole } {
  const workspace = new URL(page.url()).pathname.split("/")[2] ?? "";
  const role = (Object.keys(workspaceByRole) as FabricRole[]).find((candidate) => workspaceByRole[candidate] === workspace);
  if (!role) throw new Error(`Not inside a workspace: ${page.url()}`);
  return { workspace, role };
}

/** The signed-in identity shown in the workspace sidebar. */
export function workspaceIdentity(page: Page, name: string) {
  return page.getByRole("complementary", { name: "Workspace" }).getByText(name, { exact: true });
}

/** Opens a sub-page of the current workspace, such as "claims" or "documents". */
export async function openPage(page: Page, section: string) {
  const { workspace } = currentRole(page);
  const href = sectionHref(workspace, section);
  if (new URL(page.url()).pathname !== href) await page.goto(href);
  await expect(page).toHaveURL(new RegExp(`${href}$`));
}

/** Opens the sub-page whose form offers this operation and selects it. */
export async function openOperation(page: Page, operation: string) {
  const { role } = currentRole(page);
  const section = sectionForOperation(role, operation);
  if (!section) throw new Error(`No workspace page offers ${operation} for ${role}`);
  await openPage(page, section.id);
  const card = page.locator("#guided-workflow");
  await expect(card).toBeVisible({ timeout: 30_000 });
  const selector = card.getByLabel("Workflow action");
  if (await selector.count() && await selector.inputValue() !== operation) await selector.selectOption(operation);
  return card;
}
