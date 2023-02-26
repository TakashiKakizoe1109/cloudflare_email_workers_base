const PostalMime = require('postal-mime');

async function streamToArrayBuffer(stream, streamSize) {
    let result = new Uint8Array(streamSize);
    let bytesRead = 0;
    const reader = stream.getReader();
    while (true) {
        const {done, value} = await reader.read();
        if (done) {
            break;
        }
        result.set(value, bytesRead);
        bytesRead += value.length;
    }
    return result;
}

async function gatherResponse(response) {
    const {headers} = response;
    const contentType = headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        return JSON.stringify(await response.json());
    } else if (contentType.includes('application/text')) {
        return response.text();
    } else if (contentType.includes('text/html')) {
        return response.text();
    } else {
        return response.text();
    }
}

export default {
    async email(event, env, ctx) {

        const emailData = await streamToArrayBuffer(event.raw, event.rawSize);
        const parser = new PostalMime.default();
        const parsedEmail = await parser.parse(emailData);

        const emailSubject = parsedEmail.subject;
        const emailHtmlBody = parsedEmail.html;
        const emailTextBody = parsedEmail.text;
        console.log(emailSubject, emailHtmlBody, emailTextBody);

        let notifyTitle = "I received an email from " + event.from + ".",
            notifyMessage = notifyTitle + "\n\n"
                + "## Subject " + "\n" + parsedEmail.subject + "\n\n"
                + "## Body " + "\n" + parsedEmail.text + "\n\n";

        // Attachments
        notifyMessage += "## Attachments " + "\n";
        if (parsedEmail.attachments.length === 0) {
            console.log("No attachments");
            notifyMessage += "No attachments" + "\n";
        } else {
            parsedEmail.attachments.forEach(att => {
                console.log("Attachment: ", att.filename);
                console.log("Attachment disposition: ", att.disposition);
                console.log("Attachment mime type: ", att.mimeType);
                console.log("Attachment size: ", att.content.byteLength);

                notifyMessage += "\n"
                    + "\n" + "Attachment: " + att.filename
                    + "\n" + "Attachment disposition: " + att.disposition
                    + "\n" + "Attachment mime type: " + att.mimeType
                    + "\n" + "Attachment size: " + att.content.byteLength
                ;
            });
        }

        let init = {},
            url,
            response,
            results;

        // LINE Notify
        try {
            const lineNotifyToken = env.LINE_NOTIFY_TOKEN;
            const body = new URLSearchParams({
                message: notifyMessage,
            });
            init = {
                method: 'POST',
                headers: {
                    'content-type': 'application/json;charset=UTF-8',
                    'Authorization': `Bearer ${lineNotifyToken}`,
                },
            };
            url = "https://notify-api.line.me/api/notify/?" + body.toString();
            response = await fetch(url, init);
            results = await gatherResponse(response);
            console.log(results);
        } catch (e) {
            console.error(e);
        }

        // Slack Notification
        try {
            const botAccessToken = env.SLACK_BOT_ACCESS_TOKEN;
            const payload = {
                attachments: [
                    {
                        title: 'From Cloudflare Email Workers.',
                        text: notifyMessage,
                        author_name: "Cloudflare Workers",
                        color: "#F6821E",
                    },
                ],
            };
            init = {
                method: "POST",
                body: JSON.stringify(payload),
                headers: {
                    "Content-Type": "application/json; charset=utf-8",
                    "Content-Length": payload.length,
                    Authorization: `Bearer ${botAccessToken}`,
                    Accept: "application/json",
                }
            };
            url = env.SLACK_WEBHOOK_URL;
            response = await fetch(url, init);
            results = await gatherResponse(response);
            console.log(results);
        } catch (e) {
            console.error(e);
        }

        // forward
        await event.forward(env.FORWARD_EMAIL_ADDRESS);
    },
};