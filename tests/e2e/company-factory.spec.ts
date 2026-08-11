import { expect, test, type APIRequestContext } from "@playwright/test";

type FactoryCompany = {
  id: string;
  prefix: string;
};

async function createCompany(request: APIRequestContext): Promise<FactoryCompany> {
  const response = await request.post("/api/companies", {
    data: { name: `Company Factory E2E ${Date.now()}` },
  });
  expect(response.ok(), `create company failed ${response.status()}: ${await response.text()}`).toBe(true);

  const company = await response.json();
  return {
    id: company.id,
    prefix: company.issuePrefix ?? company.prefix ?? company.urlKey ?? "E2E",
  };
}

test.describe("Company Factory", () => {
  let company: FactoryCompany;

  test.beforeAll(async ({ request }) => {
    company = await createCompany(request);
  });

  test.afterAll(async ({ request }) => {
    if (company?.id) await request.delete(`/api/companies/${company.id}`).catch(() => undefined);
  });

  test("renders the governed proposal form and validates its required request fields", async ({ page }) => {
    await page.goto(`/${company.prefix}/factory`);

    const factoryHero = page.getByTestId("company-factory-hero");
    await expect(factoryHero).toBeVisible({ timeout: 30_000 });
    await expect(factoryHero.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("factory-manage-agent-models")).toBeVisible();
    await expect(page.getByTestId("factory-template-catalog")).toBeVisible();
    await expect(page.getByTestId("factory-empty-state")).toBeVisible();

    const createProposal = page.getByTestId("factory-create-proposal");
    const assessTemplates = page.getByTestId("factory-assess-templates");
    await expect(createProposal).toBeDisabled();
    await expect(assessTemplates).toBeDisabled();

    await page.getByTestId("factory-chat-brief").fill(
      "We need a security audit team for smart contracts. Do not bind credentials or make external changes; provide evidence-backed remediation guidance.",
    );
    await page.getByTestId("factory-chat-intake-submit").click();
    await expect(page.getByTestId("factory-chat-intake-result")).toBeVisible();
    await expect(page.locator("#factory-title")).toHaveValue("We need a security audit team for smart contracts");
    await expect(page.locator("#factory-template")).toHaveValue("trail-of-bits-security");
    await page.locator("#factory-template").selectOption("");

    await page.locator("#factory-title").fill("Ship a governed Factory increment");
    await page.locator("#factory-request").fill("Perform a security audit for a smart contract and provide evidence-backed remediation guidance.");

    await expect(createProposal).toBeEnabled();
    await expect(assessTemplates).toBeEnabled();
    await assessTemplates.click();
    const assessment = page.getByTestId("factory-template-assessment");
    await expect(assessment).toBeVisible();
    await expect(assessment).toContainText("Trail of Bits");
    await expect(page.getByTestId("factory-template-assessment-approval")).toBeVisible();

    await page.locator("#factory-template").selectOption("gstack");
    await expect(page.getByTestId("factory-template-target")).toBeVisible();
    await expect(createProposal).toBeDisabled();
    await page.locator("#factory-workspace").fill("/tmp");
    await expect(createProposal).toBeEnabled();
    await expect(createProposal.locator(".." )).toBeVisible();
  });
});
