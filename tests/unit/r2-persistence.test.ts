import { describe, expect, it, vi } from "vitest";
import { putR2ObjectWithMetadata } from "../../src/server/r2-persistence";

function bucketWith(put: ReturnType<typeof vi.fn>, remove: ReturnType<typeof vi.fn>) {
  return { put, delete: remove } as unknown as R2Bucket;
}

describe("R2 metadata persistence", () => {
  it("returns the metadata result without deleting a successfully persisted object", async () => {
    const put = vi.fn().mockResolvedValue({});
    const remove = vi.fn().mockResolvedValue(undefined);
    const persistMetadata = vi.fn().mockResolvedValue({ id: "upload-a" });

    await expect(putR2ObjectWithMetadata({
      bucket: bucketWith(put, remove),
      objectKey: "event/user/upload-a",
      value: "file contents",
      options: { httpMetadata: { contentType: "text/plain" } },
      persistMetadata,
    })).resolves.toEqual({ id: "upload-a" });

    expect(put).toHaveBeenCalledOnce();
    expect(persistMetadata).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes the new object and rethrows the original metadata failure", async () => {
    const metadataError = new Error("D1 insert failed");
    const put = vi.fn().mockResolvedValue({});
    const remove = vi.fn().mockResolvedValue(undefined);

    const promise = putR2ObjectWithMetadata({
      bucket: bucketWith(put, remove),
      objectKey: "event/user/upload-a",
      value: "file contents",
      persistMetadata: vi.fn().mockRejectedValue(metadataError),
    });

    await expect(promise).rejects.toBe(metadataError);
    expect(remove).toHaveBeenCalledExactlyOnceWith("event/user/upload-a");
  });

  it("preserves the metadata failure when cleanup also fails", async () => {
    const metadataError = new Error("D1 insert failed");
    const cleanupError = new Error("R2 delete failed");

    const promise = putR2ObjectWithMetadata({
      bucket: bucketWith(vi.fn().mockResolvedValue({}), vi.fn().mockRejectedValue(cleanupError)),
      objectKey: "event/user/upload-a",
      value: "file contents",
      persistMetadata: vi.fn().mockRejectedValue(metadataError),
    });

    await expect(promise).rejects.toBe(metadataError);
  });

  it("does not persist metadata or delete when the initial object write fails", async () => {
    const putError = new Error("R2 put failed");
    const remove = vi.fn();
    const persistMetadata = vi.fn();

    const promise = putR2ObjectWithMetadata({
      bucket: bucketWith(vi.fn().mockRejectedValue(putError), remove),
      objectKey: "event/user/upload-a",
      value: "file contents",
      persistMetadata,
    });

    await expect(promise).rejects.toBe(putError);
    expect(persistMetadata).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
