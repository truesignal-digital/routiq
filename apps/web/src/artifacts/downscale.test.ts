// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { downscaleImage } from "./upload.js";

/**
 * A phone camera photo is 3–8 MB (#95). It never reaches the 25 MB presign
 * limit as it is: anything over 1 MB is redrawn at 1600 px on its long side
 * and sent as a JPEG of at most 1 MB.
 */
describe("downscaleImage on a camera photo (#95)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function cameraPhoto(megabytes: number): File {
    return new File([new Uint8Array(megabytes * 1_000_000)], "IMG_20261006_101500.jpg", {
      type: "image/jpeg",
    });
  }

  function stubCanvas(outputBytes: (quality: number) => number) {
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 4000, height: 3000 }));
    const sizes: Array<{ width: number; height: number }> = [];
    const qualities: number[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      sizes.push({ width: this.width, height: this.height });
      return { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback, type, quality) => {
      qualities.push(quality ?? 1);
      callback(new Blob([new Uint8Array(outputBytes(quality ?? 1))], { type: type ?? "image/png" }));
    });
    return { sizes, qualities };
  }

  it.each([3, 5, 8])("sends a %i MB photo as a 1600 px JPEG under 1 MB", async (megabytes) => {
    const { sizes, qualities } = stubCanvas(() => 420_000);

    const blob = await downscaleImage(cameraPhoto(megabytes));

    expect(sizes).toEqual([{ width: 1600, height: 1200 }]);
    expect(qualities).toEqual([0.8]);
    expect(blob.type).toBe("image/jpeg");
    expect(blob.size).toBeLessThanOrEqual(1_000_000);
  });

  it("lowers the quality until the photo fits", async () => {
    const { qualities } = stubCanvas((quality) => (quality > 0.5 ? 1_400_000 : 900_000));

    const blob = await downscaleImage(cameraPhoto(6));

    expect(qualities).toEqual([0.8, 0.6, 0.45]);
    expect(blob.size).toBe(900_000);
  });

  it("leaves a photo already under 1 MB as it is", async () => {
    const small = cameraPhoto(0.5);
    expect(await downscaleImage(small)).toBe(small);
  });
});
