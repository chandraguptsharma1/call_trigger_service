import querystring from "querystring";

/**
 * Make outbound call via Exotel and connect to your ExoML App (Voicebot flow)
 * @param {string} toNumber - customer mobile number (10 digit or +91...)
 * @param {object} meta - optional data you want to pass (agent/customer/due...)
 */
export async function callCustomerViaExotel(customerNumber) {
    const {
        EXOTEL_SID,
        EXOTEL_API_KEY,
        EXOTEL_API_TOKEN,
        EXOTEL_HOST,
        EXOTEL_CALLER_ID,
        EXOTEL_APP_ID,
        PUBLIC_BASE_URL,
    } = process.env;

    const endpoint = `https://${EXOTEL_HOST}/v1/Accounts/${EXOTEL_SID}/Calls/connect.json`;

    const body = new URLSearchParams({
        From: customerNumber,
        CallerId: EXOTEL_CALLER_ID,
        Url: `http://my.exotel.com/${EXOTEL_SID}/exoml/start_voice/${EXOTEL_APP_ID}`,
        StatusCallback: `${process.env.PUBLIC_BASE_URL}/exotel/status`,
    });


    const auth = Buffer.from(`${EXOTEL_API_KEY}:${EXOTEL_API_TOKEN}`).toString("base64");

    const res = await fetch(endpoint, {
        method: "POST",
        headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(text);
    return text;
}


