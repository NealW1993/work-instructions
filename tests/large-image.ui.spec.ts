import { expect, test } from "@playwright/test";

const userId = "a1000000-0000-0000-0000-000000000001";
const instructionId = "a3000000-0000-0000-0000-000000000001";
const stamp = "2026-11-01T12:00:00Z";
const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: userId, role: "authenticated", aud: "authenticated", exp: 2_000_000_000 })).toString("base64url")}.fixture-signature`;
const session = { access_token: token, refresh_token: "fixture-refresh", expires_in: 3600, expires_at: 2_000_000_000, token_type: "bearer", user: { id: userId, aud: "authenticated", role: "authenticated", email: "reviewer@example.invalid", created_at: stamp, app_metadata: { provider: "email" }, user_metadata: { full_name: "Quality Reviewer" } } };

test("inline and attached images open by pointer and keyboard, contain large views, and return focus", async ({ page, context }, testInfo) => {
  await context.addCookies([{ name: "work-instructions-auth-token", value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`, url: "http://127.0.0.1:3100" }]);
  await page.goto(`/instructions/${instructionId}`, { waitUntil: "networkidle" });
  const dialog = page.getByRole("dialog", { name: "Enlarged instruction image", exact: true });
  const close = dialog.getByRole("button", { name: "Close image", exact: true });
  for (const viewport of [{ width: 2560, height: 1440 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(viewport);
    for (const source of [
      { kind: "inline", name: "Enlarge image: Fixture locator diagram", caption: "Fixture locator diagram" },
      { kind: "attachment", name: "Enlarge: Fixture attachment diagram", caption: "Fixture attachment diagram" },
    ]) {
      const trigger = page.getByRole("button", { name: source.name, exact: true });
      await expect(trigger).toBeVisible();
      for (const activation of ["pointer", "keyboard"]) {
        await test.step(`${viewport.width}px ${source.kind} ${activation}`, async () => {
          if (activation === "pointer") await trigger.click();
          else { await trigger.focus(); await trigger.press("Enter"); }
          await expect(dialog).toBeVisible();
          const captionContrast = await dialog.getByText(source.caption, { exact: true }).evaluate((node) => {
            const context = document.createElement("canvas").getContext("2d")!;
            const channels = (value: string) => {
              context.clearRect(0, 0, 1, 1);
              context.fillStyle = value;
              context.fillRect(0, 0, 1, 1);
              const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
              return [red, green, blue, alpha / 255];
            };
            const composite = (foreground: number[], background: number[]) => foreground.slice(0, 3).map((value, index) => value * (foreground[3] ?? 1) + background[index] * (1 - (foreground[3] ?? 1)));
            const background = composite(channels(getComputedStyle(node.closest("dialog")!).backgroundColor), [255, 255, 255]);
            const foreground = composite(channels(getComputedStyle(node).color), background);
            const luminance = (rgb: number[]) => rgb.map((value) => { const channel = value / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
            const values = [luminance(background), luminance(foreground)];
            return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
          });
          expect(captionContrast).toBeGreaterThanOrEqual(4.5);
          const image = dialog.getByRole("img");
          await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
          await expect(image).toHaveCSS("object-fit", "contain");
          for (const target of [dialog, image]) {
            const bounds = await target.boundingBox();
            expect(bounds).not.toBeNull();
            expect(bounds!.x).toBeGreaterThanOrEqual(-1);
            expect(bounds!.y).toBeGreaterThanOrEqual(-1);
            expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
            expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
          await close.focus();
          await page.keyboard.press("Shift+Tab");
          expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
          await page.keyboard.press("Tab");
          expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
          if (activation === "pointer") {
            await dialog.screenshot({ path: testInfo.outputPath(`large-image-${viewport.width}-${source.kind}.png`) });
            await close.click();
          } else await page.keyboard.press("Escape");
          await expect(dialog).toHaveCount(0);
          await expect(trigger).toBeFocused();
        });
      }
    }
  }
});
