import {
  getDB,
  type LocalAttachmentMeta,
  type MusaedDB
} from "./db";
import { makeSyncFields, newId } from "./repositories";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export class AttachmentTooLargeError extends Error {
  constructor() {
    super("حجم الملف أكبر من الحد المسموح (10 ميغابايت)");
    this.name = "AttachmentTooLargeError";
  }
}

export function isSupportedAttachmentFile(file: File): boolean {
  return file.type.startsWith("image/") || file.type === "application/pdf";
}

export interface SaveLocalAttachmentInput {
  businessId: string;
  entityId: string;
  entityType: string;
  file: File;
}

export async function saveLocalAttachment(
  input: SaveLocalAttachmentInput,
  db: MusaedDB = getDB()
): Promise<string> {
  if (fileExceedsLimit(input.file)) {
    throw new AttachmentTooLargeError();
  }

  const id = newId();
  const blob = new Blob([await input.file.arrayBuffer()], {
    type: input.file.type || "application/octet-stream"
  });

  const meta: LocalAttachmentMeta = {
    id,
    bucket: "attachments",
    storagePath: `${input.businessId}/${input.entityType}/${id}`,
    mimeType: blob.type,
    sizeBytes: blob.size,
    entityType: input.entityType,
    entityId: input.entityId,
    ...makeSyncFields({ businessId: input.businessId })
  };

  await db.transaction("rw", [db.attachmentBlobs, db.attachmentsMeta], async () => {
    await db.attachmentBlobs.put({ id, blob });
    await db.attachmentsMeta.put(meta);
  });

  return id;
}

function fileExceedsLimit(file: File): boolean {
  return file.size > MAX_ATTACHMENT_BYTES;
}
