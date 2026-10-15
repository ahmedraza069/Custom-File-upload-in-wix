// backend/quoteHandler.jsw  (direct upload - files already uploaded by browser)
import wixData from 'wix-data';
import { files } from 'wix-media.v2';
import { elevate } from 'wix-auth';

const COLLECTION = "QuoteRequests";          // Collection ID (NO space)
const MAX_FILES = 5;
const ALLOWED_EXT = ['xlsx', 'csv', 'pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'];

// Multi Document field er native format = URL string er array
let ATTACH_SHAPE = "strings"; // "strings" (native) or "objects"

// Image (PNG/JPG) kothay jabe:
//   "attachments" = inventoryAttachments (Multi Document) e, PDF er sathe
//   "gallery"     = inventoryImages (Media Gallery field) e
/** @type {string} */
const IMAGE_TARGET = "attachments";

const clean = (v, max = 2000) => String(v == null ? "" : v).trim().slice(0, max);
const AUTH = { suppressAuth: true };

// Wix er error kokhono object hoy (message thake na), tai readable string banai
function errText(e) {
    if (!e) return "unknown error";
    if (e.message) return e.message;
    try { return JSON.stringify(e); } catch (x) { return String(e); }
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

// Shob file er jonno ekta chhoto zip download link (permanent, Wix docs onujayi).
// Fail korle submit atkabe na, khali "" return kore.
async function makeZipLink(fileUrls) {
    if (!fileUrls || fileUrls.length === 0) return "";
    try {
        const generate = elevate(files.generateFilesDownloadUrl);
        const res = await generate(fileUrls);
        return (res && res.downloadUrl) || "";
    } catch (e) {
        console.error("Zip link generation failed:", errText(e));
        return "";
    }
}

// Browser already uploaded the files directly. Ekhane validate kore document / image alada kori.
function processUploadedFiles(uploadedFiles) {
    const out = { names: [], docs: [], images: [], fileUrls: [] };
    if (!Array.isArray(uploadedFiles) || uploadedFiles.length === 0) return out;
    if (uploadedFiles.length > MAX_FILES) throw new Error("Too many files (max " + MAX_FILES + ")");

    const summary = [];

    for (let i = 0; i < uploadedFiles.length; i++) {
        const f = uploadedFiles[i] || {};
        const name = clean(f.name, 120).replace(/[^\w.\- ]/g, "_") || ("file_" + (i + 1));
        const ext = name.split(".").pop().toLowerCase();
        if (!ALLOWED_EXT.includes(ext)) throw new Error("File type not allowed: ." + ext);

        // Security: sudhu Wix media URL accept korbo (document ba image)
        const fileUrl = normalizeWixUrl(f.wixUrl, name);
        if (!fileUrl) {
            console.error("Invalid file reference received:", f.wixUrl);
            throw new Error("Invalid file reference");
        }

        out.names.push(name);
        out.fileUrls.push(fileUrl);                 // zip link er jonno (image shoho shob file)

        if (fileUrl.startsWith("wix:image://") && IMAGE_TARGET === "gallery") {
            out.images.push({ fileUrl: fileUrl, name });
            summary.push(name + " => inventoryImages");
        } else {
            // document, ba image jokhon IMAGE_TARGET = "attachments"
            out.docs.push({ fileUrl: fileUrl, name });
            summary.push(name + " => inventoryAttachments");
        }
    }

    console.log("Files summary:\n" + summary.join("\n"));
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
            att = processUploadedFiles(data.uploadedFiles);
        } catch (e) {
            console.error("Attachment error:", errText(e));
            return { success: false, error: "Attachment error: " + errText(e) };
        }

        const notes = clean(data.notes, 5000);   // sudhu client er lekha notes, kono lomba link nai
        const zipLink = await makeZipLink(att.fileUrls);

        /** @type {any} */
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
            attachmentsZipLink: zipLink
        };

        // Multi Document field (ID: inventoryAttachments)
        const docValue = att.docs.map(d =>
            ATTACH_SHAPE === "strings"
                ? d.fileUrl
                : { type: "document", src: d.fileUrl, title: d.name, name: d.name }
        );

        // Media Gallery field (ID: inventoryImages) - sudhu IMAGE_TARGET = "gallery" hole
        const imageValue = att.images.map(d => ({ type: "image", src: d.fileUrl, title: d.name }));

        // Insert attempts: full -> sudhu documents -> kichu chhara (data jeno kokhono hariye na jay)
        /** @type {any} */
        const full = { ...base };
        if (att.docs.length) full.inventoryAttachments = docValue;
        if (att.images.length) full.inventoryImages = imageValue;

        /** @type {any[]} */
        const attempts = [full];
        if (att.docs.length && att.images.length) attempts.push({ ...base, inventoryAttachments: docValue });
        if (att.docs.length || att.images.length) attempts.push(base);

        let saved = null, lastErr = null;
        for (let i = 0; i < attempts.length; i++) {
            try {
                saved = await wixData.insert(COLLECTION, attempts[i], AUTH);
                console.log("Insert OK with attempt #" + (i + 1));
                break;
            } catch (e) {
                lastErr = e;
                console.error("Insert attempt #" + (i + 1) + " failed:", errText(e));
            }
        }
        if (!saved) {
            return { success: false, error: "CMS insert failed: " + errText(lastErr) };
        }
        return { success: true, recordId: saved._id };
    } catch (err) {
        console.error("CMS Insert Error:", errText(err));
        return { success: false, error: errText(err) };
    }
}