import querystring from "querystring";

/**
 * Make outbound call via Exotel and connect to your ExoML App (Voicebot flow)
 * @param {string} customerNumber - customer mobile number (10 digit or +91...)
 */
// export async function callCustomerViaExotel(customerNumber) {
//     console.log("[Exotel] callCustomerViaExotel() called");
//     console.log("[Exotel] customerNumber:", customerNumber);

//     const {
//         EXOTEL_SID,
//         EXOTEL_API_KEY,
//         EXOTEL_API_TOKEN,
//         EXOTEL_HOST,
//         EXOTEL_CALLER_ID,
//         EXOTEL_APP_ID,
//         PUBLIC_BASE_URL,
//     } = process.env;

//     // ✅ env debug (masked)
//     console.log("[Exotel] ENV:", {
//         EXOTEL_SID: EXOTEL_SID ? `${EXOTEL_SID.slice(0, 4)}***` : null,
//         EXOTEL_API_KEY: EXOTEL_API_KEY ? `${EXOTEL_API_KEY.slice(0, 4)}***` : null,
//         EXOTEL_API_TOKEN: EXOTEL_API_TOKEN ? "***present***" : null,
//         EXOTEL_HOST,
//         EXOTEL_CALLER_ID,
//         EXOTEL_APP_ID,
//         PUBLIC_BASE_URL,
//     });

//     const endpoint = `https://${EXOTEL_HOST}/v1/Accounts/${EXOTEL_SID}/Calls/connect.json`;
//     console.log("[Exotel] endpoint:", endpoint);

//     const voiceUrl = `http://my.exotel.com/${EXOTEL_SID}/exoml/start_voice/${EXOTEL_APP_ID}`;
//     const statusCallback = `${PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL}/exotel/status`;

//     console.log("[Exotel] voiceUrl:", voiceUrl);
//     console.log("[Exotel] statusCallback:", statusCallback);

//     const body = new URLSearchParams({
//         From: customerNumber,
//         CallerId: EXOTEL_CALLER_ID,
//         Url: voiceUrl,
//         StatusCallback: statusCallback,
//     });

//     console.log("[Exotel] request body (form):", body.toString());

//     const auth = Buffer.from(`${EXOTEL_API_KEY}:${EXOTEL_API_TOKEN}`).toString("base64");
//     console.log("[Exotel] auth header:", `Basic ${auth.slice(0, 10)}... (masked)`);

//     console.log("[Exotel] sending request...");
//     const start = Date.now();

//     const res = await fetch(endpoint, {
//         method: "POST",
//         headers: {
//             Authorization: `Basic ${auth}`,
//             "Content-Type": "application/x-www-form-urlencoded",
//         },
//         body: body.toString(),
//     });

//     const ms = Date.now() - start;
//     console.log("[Exotel] response status:", res.status, res.statusText, `(${ms}ms)`);

//     // Response headers debug (optional)
//     try {
//         console.log("[Exotel] response headers:", Object.fromEntries(res.headers.entries()));
//     } catch (e) {
//         console.log("[Exotel] response headers read failed:", e?.message);
//     }

//     const text = await res.text();
//     console.log("[Exotel] response body:", text);

//     if (!res.ok) {
//         console.error("[Exotel] API ERROR:", text);
//         throw new Error(text);
//     }

//     console.log("[Exotel] call success ✅");
//     return text;
// }

// src/exotel/callCustomerViaExotel.js
// src/exotel/callCustomerViaExotel.js
// src/exotel/callCustomerViaExotel.js
// export async function callCustomerViaExotel(customerNumber) {
//     const {
//         EXOTEL_SID,
//         EXOTEL_API_KEY,
//         EXOTEL_API_TOKEN,
//         EXOTEL_CALLER_ID,
//         EXOTEL_APP_ID
//     } = process.env;

//     // v1 API Endpoint (Mumbai Stamp)
//     const endpoint = `https://api.in.exotel.com/v1/Accounts/${EXOTEL_SID}/Calls/connect.json`;

//     // Documentation ke mutabik 'Url' parameter hi flow connect karta hai
//     const body = new URLSearchParams({
//         From: customerNumber,               // Kise call karni hai
//         CallerId: EXOTEL_CALLER_ID,         // Aapka ExoPhone
//         // Ye URL pick-up karte hi aapke Passthru flow ko trigger karega
//         Url: `http://my.exotel.com/${EXOTEL_SID}/exoml/start_voice/${EXOTEL_APP_ID}`,
//         CallType: "trans"
//     });

//     const auth = Buffer.from(`${EXOTEL_API_KEY}:${EXOTEL_API_TOKEN}`).toString("base64");

//     const res = await fetch(endpoint, {
//         method: "POST",
//         headers: {
//             "Authorization": `Basic ${auth}`,
//             "Content-Type": "application/x-www-form-urlencoded" // v1 form-data mangta hai
//         },
//         body: body.toString(),
//     });

//     const text = await res.text();
//     console.log("📡 [Exotel v1] Response:", text);
//     if (!res.ok) throw new Error(text);
//     return text;
// }

export async function callCustomerViaExotel(customerNumber) {
    const {
        EXOTEL_SID,
        EXOTEL_API_KEY,
        EXOTEL_API_TOKEN,
        EXOTEL_CALLER_ID,
        EXOTEL_APP_ID,
    } = process.env;

    const endpoint = `https://api.in.exotel.com/v1/Accounts/${EXOTEL_SID}/Calls/connect.json`;

    // ✅ Exotel App/Flow URL (this will play greeting configured in Flow)
    const exomlAppUrl = `http://my.exotel.com/${EXOTEL_SID}/exoml/start_voice/${EXOTEL_APP_ID}`;

    const body = new URLSearchParams({
        From: customerNumber,        // customer number
        CallerId: EXOTEL_CALLER_ID,  // your ExoPhone
        Url: exomlAppUrl,            // ✅ your Exotel Flow/App
        // StatusCallback: `${process.env.PUBLIC_BASE_URL}/exotel/status`, // optional
    });

    const auth = Buffer.from(`${EXOTEL_API_KEY}:${EXOTEL_API_TOKEN}`).toString("base64");

    console.log("➡️ [Exotel] Calling:", { endpoint, From: customerNumber, CallerId: EXOTEL_CALLER_ID, Url: exomlAppUrl });

    const res = await fetch(endpoint, {
        method: "POST",
        headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
    });

    const text = await res.text();
    console.log("📡 [Exotel] Response:", res.status, text);

    if (!res.ok) throw new Error(text);
    return text;
}
