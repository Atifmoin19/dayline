/** Shared image-attachment constants + helpers — used by both the live (edit-task) and
 * staged (create-task, before a task id exists) attachment pickers. Mirrors the backend's
 * ALLOWED_ATTACHMENT_TYPES / MAX_ATTACHMENT_BYTES in main.py so client-side rejects match. */
export const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB

/** Read a File as a base64 data URI ("data:image/png;base64,...."). */
export const toDataUri = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
