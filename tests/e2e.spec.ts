import { expect, test, type Page } from "@playwright/test";

/**
 * VIZORA critical flows (spec §64): public site conversion paths and the
 * complete studio journey — create, upload review, direct, storyboard,
 * generate (mock), result, and the supporting product areas.
 */

const SESSION = {
  user: {
    id: "user_e2e",
    name: "Dana Levi",
    email: "dana@northview.example",
    onboarded: true,
    createdAt: "2026-08-01T09:00:00.000Z",
  },
  workspace: {
    id: "ws_e2e",
    name: "Dana's Studio",
    plan: "pro",
    createdAt: "2026-08-01T09:00:00.000Z",
  },
};

async function signIn(page: Page) {
  await page.addInitScript((session) => {
    try {
      window.localStorage.setItem("vizora:session", JSON.stringify(session));
    } catch {
      /* ignore */
    }
  }, SESSION);
}

/* ------------------------------- public site ------------------------------- */

test.describe("public website", () => {
  test("homepage communicates the promise and converts to signup", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Turn property images into marketing videos",
    );
    await expect(page.getByText("in 5 minutes").first()).toBeVisible();
    await page.getByRole("link", { name: "Create your video" }).first().click();
    await expect(page).toHaveURL(/\/signup/);
  });

  test("pricing shows plans from config and links to signup", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByText("Most popular")).toBeVisible();
    await expect(page.getByText("$79")).toBeVisible();
    await page.getByRole("link", { name: "Start with Pro" }).click();
    await expect(page).toHaveURL(/\/signup/);
  });

  test("templates gallery filters and hands the template to signup", async ({ page }) => {
    await page.goto("/templates");
    await page.getByRole("button", { name: "Social", exact: true }).click();
    await expect(page.getByText("Instagram Reel")).toBeVisible();
    await expect(page.getByText("Luxury Apartment")).toHaveCount(0);
    await page.getByRole("link", { name: "Use template" }).first().click();
    await expect(page).toHaveURL(/\/signup\?template=instagram-reel/);
  });

  test("login and signup are reachable and validated", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Enter the email you signed up with.")).toBeVisible();
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  });
});

/* ------------------------------ studio journey ------------------------------ */

test.describe("studio journey", () => {
  test("sample property: wizard → storyboard → generate → result → reopen", async ({ page }) => {
    await signIn(page);
    await page.goto("/app/create");

    // Method chooser + sample entry
    await expect(page.getByRole("heading", { name: "How do you want to start?" })).toBeVisible();
    await page.getByRole("button", { name: "Try a sample property" }).click();
    await page.waitForURL(/\/app\/projects\//);

    // Wizard: upload review (sample assets preloaded)
    await expect(page.getByRole("heading", { name: "Add your property images" })).toBeVisible();
    await expect(page.getByText("5 images")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    // Property details (prefilled)
    await expect(page.getByLabel("Property / project name")).toHaveValue("Azure Residences");
    await page.getByRole("button", { name: "Continue" }).click();

    // Style
    await page.getByRole("button", { name: /Cinematic/ }).first().click();
    await page.getByRole("button", { name: "Continue" }).click();

    // Format + build
    await page.getByRole("button", { name: "Build my storyboard" }).click();

    // Studio with scenes + preview
    await expect(page.getByText("Storyboard preview")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Closing card")).toBeVisible();

    // Edit a scene caption
    await page.getByRole("button", { name: /^Edit Opening exterior$/ }).click();
    await page.getByLabel("On-screen caption").fill("A new landmark on the Limassol seafront.");
    await page.getByRole("button", { name: "Save scene" }).click();
    await expect(page.getByText("A new landmark on the Limassol seafront.").first()).toBeVisible();

    // Generate (mock ~45–55s)
    await page.getByRole("button", { name: "Generate video" }).click();
    await expect(page.getByText("Your video will be ready in about 5 minutes")).toBeVisible();
    await expect(page.getByText("Your video is")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole("button", { name: "Download" })).toBeVisible();

    // Reopen from projects — result view persists
    await page.getByRole("link", { name: "Projects" }).first().click();
    await page.waitForURL(/\/app\/projects$/);
    await page
      .getByRole("link", { name: /Open Azure Residences/ })
      .first()
      .click();
    await expect(page.getByText("Your video is")).toBeVisible();
  });

  test("upload flow accepts a real file into a new images project", async ({ page }) => {
    await signIn(page);
    await page.goto("/app/create?method=images");
    await page.waitForURL(/\/app\/projects\//);
    await expect(page.getByRole("heading", { name: "Add your property images" })).toBeVisible();

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.setInputFiles('input[type="file"]', {
      name: "terrace-view.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(page.getByText("terrace-view")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("1 image")).toBeVisible();
  });
});

/* ---------------------------- supporting areas ---------------------------- */

test.describe("supporting product areas", () => {
  test("dashboard, duplicate and delete a project", async ({ page }) => {
    await signIn(page);
    await page.goto("/app");
    await expect(page.getByText("What property are we turning into a video today?")).toBeVisible();

    await page.goto("/app/projects");
    await page.getByRole("button", { name: "Actions for Casa Marina" }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await page.waitForURL(/\/app\/projects\//);

    await page.goto("/app/projects");
    await expect(page.getByText("Casa Marina copy")).toBeVisible();
    await page.getByRole("button", { name: "Actions for Casa Marina copy" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete project" }).click();
    await expect(page.getByText("Casa Marina copy")).toHaveCount(0);
  });

  test("app template starts a project with the template structure", async ({ page }) => {
    await signIn(page);
    await page.goto("/app/templates");
    await page
      .getByRole("button", { name: "Use template" })
      .first()
      .click();
    await page.waitForURL(/\/app\/projects\//);
    await expect(page.getByRole("heading", { name: "Add your property images" })).toBeVisible();
  });

  test("brand kit saves and settings sections load", async ({ page }) => {
    await signIn(page);
    await page.goto("/app/brand");
    await page.getByLabel("Brand name").fill("Northview Estates");
    await page.getByRole("button", { name: "Save brand kit" }).click();
    await expect(page.getByText("Brand kit saved")).toBeVisible();

    await page.goto("/app/settings");
    await expect(page.getByRole("heading", { name: "Profile" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Subscription" }).click();
    await expect(page.getByText("Current plan")).toBeVisible();
    await page.getByRole("button", { name: "Data & Privacy" }).click();
    await expect(page.getByRole("button", { name: "Export workspace data" })).toBeVisible();
  });

  test("assets library lists samples with detail dialog", async ({ page }) => {
    await signIn(page);
    await page.goto("/app/assets");
    await expect(page.getByText("Azure — seafront exterior")).toBeVisible();
    await page.getByRole("button", { name: /Azure — seafront exterior/ }).click();
    await expect(page.getByText("Used in")).toBeVisible();
  });

  test("mobile shell: bottom nav and sheet menu", async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app");
    const bottomNav = page.getByRole("navigation", { name: "Primary" });
    await expect(bottomNav.getByRole("link", { name: "Create video" })).toBeVisible();
    await bottomNav.getByRole("link", { name: "Projects" }).click();
    await expect(page).toHaveURL(/\/app\/projects/);
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("link", { name: "Brand Kit" })).toBeVisible();
  });
});
