import { openSidebar, type DriveContext, type DriveScript } from "../browser.js";

/**
 * Photos from the phone camera (#95), on VH001's Report a problem form.
 *
 * On a phone viewport (`--viewport 390x844`): the photo field offers Take photo
 * (accept image/*, capture=environment) beside Choose file; a camera-sized JPEG
 * (3–8 MB, made in the page as the camera would hand it over) is given to the
 * camera input, uploads, and the problem is reported with it. The API
 * cross-check reads the stored file back: a JPEG under 1 MB. On a desktop: the
 * drop zone and picker only, no Take photo. Mutates the slot on a phone;
 * reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:camera-capture --role driver --lang en --viewport 390x844
 *      pnpm verify drive flow:camera-capture --role driver --lang en
 */
const DESCRIPTION = "Cracked windscreen, photo from the cab";

/** Lets the screencast paint what just opened before a shot holds the frame. */
const settle = (ctx: DriveContext) => ctx.page.waitForTimeout(700);

async function openReportForm(ctx: DriveContext): Promise<string> {
  const { page, t, quiet } = ctx;
  await (await openSidebar(page)).getByRole("link", { name: t("Camions", "Trucks") }).click();
  await page.getByRole("button", { name: /VH001/ }).first().click();
  await page.getByRole("heading", { level: 1, name: "VH001" }).waitFor();
  await quiet();
  const assetId = /\/assets\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (assetId === undefined) throw new Error(`no asset id in ${page.url()}`);
  // "Report a problem" in the header on a desktop, "Problem" in the phone's quick bar.
  await page
    .getByRole("button", { name: new RegExp(`^(${t("Signaler un problème", "Report a problem")}|${t("Problème", "Problem")})$`) })
    .first()
    .click();
  await page.getByRole("dialog", { name: t("Signaler un problème", "Report a problem") }).waitFor();
  return assetId;
}

/** A 4000 × 3000 JPEG of camera size, drawn in the page (a sensor's noise keeps it big). */
async function cameraJpeg(ctx: DriveContext): Promise<Buffer> {
  const base64 = await ctx.page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 4000;
    canvas.height = 3000;
    const g = canvas.getContext("2d");
    if (g === null) throw new Error("no 2d context");
    const image = g.createImageData(canvas.width, canvas.height);
    let seed = 42;
    for (let i = 0; i < image.data.length; i += 4) {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      const noise = seed % 64;
      const x = (i / 4) % canvas.width;
      image.data[i] = (x / 16 + noise) & 255;
      image.data[i + 1] = (120 + noise) & 255;
      image.data[i + 2] = (200 - noise) & 255;
      image.data[i + 3] = 255;
    }
    g.putImageData(image, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (blob === null) throw new Error("toBlob gave nothing");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  });
  return Buffer.from(base64, "base64");
}

async function onPhone(ctx: DriveContext, assetId: string): Promise<void> {
  const { page, t, shot, quiet, log, apiGet } = ctx;
  const dialog = page.getByRole("dialog", { name: t("Signaler un problème", "Report a problem") });
  const takePhoto = dialog.getByRole("button", { name: t("Prendre une photo", "Take photo") });
  const chooseFile = dialog.getByRole("button", { name: t("Choisir un fichier", "Choose file") });
  await takePhoto.scrollIntoViewIfNeeded();
  if (!(await takePhoto.isVisible()) || !(await chooseFile.isVisible())) {
    throw new Error("the photo field offers no Take photo beside Choose file on a phone");
  }
  const camera = dialog.locator('input[type="file"][capture]');
  const accept = await camera.getAttribute("accept");
  const capture = await camera.getAttribute("capture");
  if (accept !== "image/*" || capture !== "environment") {
    throw new Error(`camera input accept=${String(accept)} capture=${String(capture)}`);
  }
  await settle(ctx);
  await shot("phone-photo-field", {
    caption: "On a phone the photo field offers Take photo beside Choose file",
    highlight: takePhoto.locator(".."),
  });

  const photo = await cameraJpeg(ctx);
  const megabytes = photo.length / 1_000_000;
  if (megabytes < 3 || megabytes > 8) throw new Error(`test photo is ${megabytes.toFixed(1)} MB, not 3–8 MB`);
  log(`camera photo: 4000 × 3000 JPEG, ${megabytes.toFixed(1)} MB`);
  await camera.setInputFiles({ name: "IMG_20261006_101500.jpg", mimeType: "image/jpeg", buffer: photo });
  await dialog.getByText("IMG_20261006_101500.jpg").waitFor();
  await dialog.getByRole("progressbar").waitFor({ state: "detached", timeout: 60_000 });
  await dialog.getByLabel("Description").fill(DESCRIPTION);
  await settle(ctx);
  await shot("photo-attached", {
    caption: "The camera photo is attached and uploaded",
    highlight: dialog.getByText("IMG_20261006_101500.jpg"),
  });

  await dialog.getByRole("button", { name: t("Signaler le problème", "Report the problem") }).click();
  await page.getByText(t("Problème signalé", "Problem reported")).first().waitFor();
  await quiet();
  await settle(ctx);
  await shot("reported", { caption: "The problem is reported with its photo" });

  const issues = await apiGet(`/v1/issues?assetId=${assetId}`);
  const issue = ((issues.body as { items?: Array<{ id: string; description: string }> }).items ?? []).find(
    (item) => item.description === DESCRIPTION,
  );
  if (issue === undefined) throw new Error("the reported problem is not in GET /v1/issues");
  const detail = await apiGet(`/v1/issues/${issue.id}`);
  const files = (detail.body as { artifacts?: Array<{ mimeType: string; sizeBytes: number }> }).artifacts ?? [];
  const [file] = files;
  if (files.length !== 1 || file === undefined || file.mimeType !== "image/jpeg" || file.sizeBytes > 1_000_000) {
    throw new Error(`stored files: ${JSON.stringify(files)}`);
  }
  log(`api cross-check: problem ${issue.id.slice(0, 8)} has 1 photo, ${file.mimeType}, ${file.sizeBytes} B (from ${photo.length} B)`);
}

async function onDesktop(ctx: DriveContext): Promise<void> {
  const { page, t, shot, log } = ctx;
  const dialog = page.getByRole("dialog", { name: t("Signaler un problème", "Report a problem") });
  // The drop zone, not the file input behind it that carries the same name.
  const dropzone = dialog
    .locator("button")
    .filter({ hasText: t("Déposez les fichiers ici ou cliquez pour choisir", "Drop files here or click to choose") });
  await dropzone.waitFor();
  if (await dialog.getByRole("button", { name: t("Prendre une photo", "Take photo") }).isVisible()) {
    throw new Error("a desktop shows Take photo");
  }
  await settle(ctx);
  await shot("desktop-photo-field", {
    caption: "A desktop keeps the drop zone and file picker only",
    highlight: dropzone,
  });
  log("desktop: drop zone visible, Take photo hidden");
}

const flow: DriveScript = async (ctx) => {
  const assetId = await openReportForm(ctx);
  const width = ctx.page.viewportSize()?.width ?? 1440;
  if (width < 768) await onPhone(ctx, assetId);
  else await onDesktop(ctx);
};

export default flow;
