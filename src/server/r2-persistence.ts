type R2PutValue = Parameters<R2Bucket["put"]>[1];
type R2PutOptions = Parameters<R2Bucket["put"]>[2];

export interface R2MetadataWrite<T> {
  bucket: R2Bucket;
  objectKey: string;
  value: R2PutValue;
  options?: R2PutOptions;
  persistMetadata: () => Promise<T>;
}

/**
 * Writes the object first, then its D1 metadata. A failed metadata write removes
 * the newly-created object so it cannot become an untracked R2 orphan.
 */
export async function putR2ObjectWithMetadata<T>({
  bucket,
  objectKey,
  value,
  options,
  persistMetadata,
}: R2MetadataWrite<T>): Promise<T> {
  await bucket.put(objectKey, value, options);

  try {
    return await persistMetadata();
  } catch (metadataError) {
    try {
      await bucket.delete(objectKey);
    } catch {
      // Cleanup is best effort; callers must receive the original D1 failure.
    }
    throw metadataError;
  }
}
