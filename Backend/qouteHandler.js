// backend/quoteHandler.jsw  (direct upload - files already uploaded by browser)
import wixData from 'wix-data';
import { mediaManager } from 'wix-media-backend';
import { fetch } from 'wix-fetch';

const COLLECTION = "QuoteRequests";          // Collection ID (NO space)
const MAX_FILES = 5;
const ALLOWED_EXT = ['xlsx', 'csv', 'pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'];
const MIME = {
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    csv: "text/csv",
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png"
};

// Multi Document field er native format = URL string er array
let ATTACH_SHAPE = "strings"; // "strings" (native) or "objects"

const clean = (v, max = 2000) => String(v == null ? "" : v).trim().slice(0, max);
const AUTH = { suppressAuth: true };

// DIAGNOSTIC: run once from Dev Mode (Run button).
export async function inspectAttachments() {
    const res = await wixData.query(COLLECTION).isNotEmpty("inventoryAttachments").limit(5).find(AUTH);
    const out = res.items.map(i => ({ name: i.fullName, value: i.inventoryAttachments }));
    console.log("INSPECT:", JSON.stringify(out, null, 2));
    return JSON.stringify(out, null, 2);
}

// Upload response er relative path ("ugd/..." ba "media/...") ke proper Wix URL e convert kore.
function normalizeWixUrl(rawUrl, name) {
    const u = String(rawUrl || "").trim();
    if (u.startsWith("wix:document://") || u.startsWith("wix:image://")) return u;

    const encName = encodeURIComponent(name || "file");
    if (u.startsWith("ugd/")) return "wix:document://v1/" + u + "/" + encName;
    if (u.startsWith("media/")) return "wix:image://v1/" + u.replace(/^media\//, "") + "/" + encName;
    return "";
}

// wix-fetch response theke Buffer pawar helper (wix-fetch e arrayBuffer() nai, buffer() ache)
async function responseToBuffer(res) {
    if (typeof res.buffer === "function") {
        return await res.buffer();
    }
    if (typeof res.arrayBuffer === "function") {
        return Buffer.from(await res.arrayBuffer());
    }
    throw new Error("Unsupported fetch response type");
}

// Image (wix:image://) ke "document" hishebe abar upload kore -> wix:document:// URL pay.
// Karon Multi Document field e sudhu document URL match kore.
async function convertImageToDocument(imageUrl, name, ext, index) {
    const downloadUrl = await mediaManager.getDownloadUrl(imageUrl);
    const res = await fetch(downloadUrl, { method: "get" });
    if (!res.ok) throw new Error("Could not read uploaded image (" + res.status + ")");

    const buffer = await responseToBuffer(res);
    const info = await mediaManager.upload(
        "/Quote Attachments",
        buffer,
        Date.now() + "_" + index + "_" + name,
        {
            mediaOptions: { mimeType: MIME[ext], mediaType: "document" },
            metadataOptions: { isPrivate: false, isVisitorUpload: true }
        }
    );

    // Ager image copy ta trash e pathai (duplicate na thakar jonno)
    try { await mediaManager.moveFilesToTrash([imageUrl]); } catch (e) { console.warn("Trash original image failed", e); }

    return info.fileUrl;
}

// Browser already uploaded the files directly. Ekhane validate + document URL toiri kori.
async function processUploadedFiles(uploadedFiles) {
    const out = { names: [], links: [], docs: [] };
    if (!Array.isArray(uploadedFiles) || uploadedFiles.length === 0) return out;
    if (uploadedFiles.length > MAX_FILES) throw new Error("Too many files (max " + MAX_FILES + ")");

    for (let i = 0; i < uploadedFiles.length; i++) {
        const f = uploadedFiles[i] || {};
        const name = clean(f.name, 120).replace(/[^\w.\- ]/g, "_") || ("file_" + (i + 1));
        const ext = name.split(".").pop().toLowerCase();
        if (!ALLOWED_EXT.includes(ext)) throw new Error("File type not allowed: ." + ext);

        // Security: sudhu Wix media URL accept korbo (document ba image)
        let fileUrl = normalizeWixUrl(f.wixUrl, name);
        if (!fileUrl) {
            console.error("Invalid file reference received:", f.wixUrl);
            throw new Error("Invalid file reference");
        }

        // Image hole document e convert kori (Multi Document field er jonno)
        let addToField = true;
        if (fileUrl.startsWith("wix:image://")) {
            try {
                fileUrl = await convertImageToDocument(fileUrl, name, ext, i);
            } catch (e) {
                // Fail hole submit atkabe na: link notes e thakbe, sudhu field e jabe na
                console.error("Image -> document conversion failed (kept as link only):", name, e);
                addToField = false;
            }
        }

        let url = fileUrl;
        try { url = await mediaManager.getDownloadUrl(fileUrl); } catch (e) { console.warn("getDownloadUrl failed", e); }

        out.names.push(name);
        out.links.push(name + " -> " + url);
        if (addToField) out.docs.push({ fileUrl: fileUrl, name });
    }
    return out;
}

export async function processQuoteSubmission(data) {
    try {
        if (!data || data.type !== "submitQuoteData") return { success: false, error: "Bad request" };
        if (data.hp) return { success: true, recordId: "ok" };                                   // honeypot
        if (data.elapsedMs && data.elapsedMs < 3000) return { success: true, recordId: "ok" };   // too fast = bot

        const email = clean(data.email, 200);
        if (!clean(data.fullName) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return { success: false, error: "Please check your name and email." };
        }

        let att;
        try {
            att = await processUploadedFiles(data.uploadedFiles);
        } catch (e) {
            console.error("Attachment error:", e);
            return { success: false, error: "Attachment error: " + (e && e.message ? e.message : JSON.stringify(e)) };
        }

        const notes = clean(data.notes, 5000) + (att.links.length ? "\n\nAttached Files:\n" + att.links.join("\n") : "");

        const base = {
            fullName: clean(data.fullName, 200),
            company: clean(data.company, 200),
            email: email,
            phone: clean(data.phone, 50),
            customerType: clean(data.customerType, 100),
            hardwareTypes: Array.isArray(data.hardwareTypes) ? data.hardwareTypes.map(h => clean(h, 50)).join(", ") : "",
            quantity: clean(data.quantity, 50),
            collectionMethod: clean(data.collectionMethod, 100),
            zipCode: clean(data.zipCode, 20),
            timeline: clean(data.timeline, 100),
            condition: clean(data.condition, 100),
            notes: notes,
            attachmentNames: att.names.join(", "),
            attachmentLinks: att.links.join("\n")
        };

        // Multi Document field (ID: inventoryAttachments) = array of wix:document:// strings
        const docValue = att.docs.map(d =>
            ATTACH_SHAPE === "strings"
                ? d.fileUrl
                : { type: "document", src: d.fileUrl, title: d.name, name: d.name }
        );
        const attempts = att.docs.length
            ? [{ ...base, inventoryAttachments: docValue }, base]
            : [base];

        let saved = null, lastErr = null;
        for (let i = 0; i < attempts.length; i++) {
            try {
                saved = await wixData.insert(COLLECTION, attempts[i], AUTH);
                console.log("Insert OK with attempt #" + (i + 1));
                break;
            } catch (e) {
                lastErr = e;
                console.error("Insert attempt #" + (i + 1) + " failed:", e);
            }
        }
        if (!saved) {
            return { success: false, error: "CMS insert failed: " + ((lastErr && (lastErr.message || lastErr.code)) || JSON.stringify(lastErr)) };
        }
        return { success: true, recordId: saved._id };
    } catch (err) {
        console.error("CMS Insert Error:", err);
        return { success: false, error: (err && err.message) || String(err) };
    }
}