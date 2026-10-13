// Contact Us page code
import { processQuoteSubmission } from 'backend/quoteHandler.jsw';
import { getQuoteUploadUrls } from 'backend/fileUpload.jsw';

$w.onReady(function () {
    $w("#html1").onMessage(async (event) => {
        const d = event.data;
        if (!d) return;

        // 1) HTML embed direct upload URL chay
        if (d.type === "requestUploadUrls") {
            try {
                const urls = await getQuoteUploadUrls(d.fileInfos);
                $w("#html1").postMessage({ type: "uploadUrlsResponse", urls: urls });
            } catch (e) {
                console.error("Failed to fetch upload URLs:", e);
                $w("#html1").postMessage({
                    type: "form_error",
                    error: "Could not prepare file upload: " + String(e.message || e)
                });
            }
            return;
        }

        // 2) Final submit (file upload shesh hoye gele)
        if (d.type !== "submitQuoteData") return;

        try {
            const result = await processQuoteSubmission(d);
            if (result && result.success) {
                $w("#html1").postMessage("form_success");
            } else {
                console.error("Submit failed:", result && result.error);
                $w("#html1").postMessage({ type: "form_error", error: (result && result.error) || "" });
            }
        } catch (err) {
            console.error("Error inserting data:", err);
            $w("#html1").postMessage({ type: "form_error", error: "Backend call failed: " + String(err.message || err) });
        }
    });
});