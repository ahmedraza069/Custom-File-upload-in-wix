// backend/fileUpload.jsw
import { mediaManager } from 'wix-media-backend';

const MAX_FILES = 5;
const MAX_TOTAL_BYTES = 15 * 1024 * 1024; // HTML er sathe same rakhbe

// ext -> { mime, mediaType }  (getUploadUrl extension & mediaType match check kore)
const FILE_TYPES = {
    xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", mediaType: "document" },
    csv:  { mime: "text/csv", mediaType: "document" },
    pdf:  { mime: "application/pdf", mediaType: "document" },
    doc:  { mime: "application/msword", mediaType: "document" },
    docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", mediaType: "document" },
    jpg:  { mime: "image/jpeg", mediaType: "image" },
    jpeg: { mime: "image/jpeg", mediaType: "image" },
    png:  { mime: "image/png", mediaType: "image" }
};

export async function getQuoteUploadUrls(fileInfos) {
    if (!Array.isArray(fileInfos) || fileInfos.length === 0) return [];
    if (fileInfos.length > MAX_FILES) throw new Error("Too many files (max " + MAX_FILES + ")");

    let total = 0;
    const urls = [];

    for (const file of fileInfos) {
        const name = String(file.name || "file").slice(0, 120);
        const ext = name.split(".").pop().toLowerCase();
        const t = FILE_TYPES[ext];
        if (!t) throw new Error("File type not allowed: ." + ext);

        total += Number(file.size) || 0;
        if (total > MAX_TOTAL_BYTES) throw new Error("Files too large");

        try {
            const uploadInfo = await mediaManager.getUploadUrl(
                "/Quote Attachments",
                {
                    mediaOptions: { mimeType: t.mime, mediaType: t.mediaType },
                    metadataOptions: { isPrivate: false, isVisitorUpload: true }
                }
            );
            urls.push({ name: file.name, uploadUrl: uploadInfo.uploadUrl, mimeType: t.mime });
        } catch (error) {
            console.error("Upload URL error for file:", file.name, error);
            urls.push({ name: file.name, uploadUrl: null, mimeType: t.mime });
        }
    }
    return urls;
}