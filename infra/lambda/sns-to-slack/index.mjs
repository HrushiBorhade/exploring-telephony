/**
 * SNS → Slack Lambda bridge.
 * Receives CloudWatch alarm events via SNS and posts to Slack.
 */
export async function handler(event) {
  const webhookUrl = process.env.SLACK_ALERTS_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error("SLACK_ALERTS_WEBHOOK_URL not set");
    return { statusCode: 500 };
  }

  for (const record of event.Records) {
    const message = record.Sns.Message;
    let parsed;
    try {
      parsed = JSON.parse(message);
    } catch {
      parsed = null;
    }

    // CloudWatch Alarm SNS payload
    const alarmName = parsed?.AlarmName || "Unknown Alarm";
    const newState = parsed?.NewStateValue || "UNKNOWN";
    const reason = parsed?.NewStateReason || message;
    const region = parsed?.Region || "ap-south-1";
    const timestamp = parsed?.StateChangeTime || new Date().toISOString();

    const color = newState === "ALARM" ? "#E01E5A" : newState === "OK" ? "#36a64f" : "#CCCCCC";
    const emoji = newState === "ALARM" ? "🚨" : newState === "OK" ? "✅" : "ℹ️";

    const payload = {
      attachments: [
        {
          color,
          blocks: [
            {
              type: "header",
              text: { type: "plain_text", text: `${emoji} ${alarmName}`, emoji: true },
            },
            {
              type: "section",
              fields: [
                { type: "mrkdwn", text: `*State:*\n${newState}` },
                { type: "mrkdwn", text: `*Region:*\n${region}` },
              ],
            },
            {
              type: "section",
              text: { type: "mrkdwn", text: `*Reason:*\n${reason.slice(0, 500)}` },
            },
            {
              type: "context",
              elements: [
                { type: "mrkdwn", text: `${new Date(timestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST` },
              ],
            },
          ],
        },
      ],
    };

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error(`Slack webhook failed: ${res.status} ${await res.text()}`);
    }
  }

  return { statusCode: 200 };
}
