/**
 * Shared Slack notification utility.
 *
 * Uses native fetch() — no external dependencies.
 * If SLACK_WEBHOOK_URL is not set, all calls silently no-op (dev mode).
 */

export interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  fields?: { type: string; text: string }[];
  elements?: unknown[];
  [key: string]: unknown;
}

export interface SlackPayload {
  blocks?: SlackBlock[];
  attachments?: {
    color?: string;
    blocks?: SlackBlock[];
  }[];
  text?: string;
}

/**
 * Post a Block Kit payload to the configured Slack webhook.
 * No-ops when SLACK_WEBHOOK_URL is missing (local dev).
 */
export async function notifySlack(payload: SlackPayload): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Slack webhook responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

/**
 * Send a formatted P0/P1 error alert to Slack.
 *
 * Renders a red-sidebar attachment with error type, message, timestamp (IST),
 * and optional context fields (captureId, jobId, etc.).
 *
 * Usage (fire-and-forget):
 *   notifySlackError({ type: "job-failure", error: err.message, context: { captureId } })
 *     .catch((e) => logger.error({ err: e }, "Slack error notification failed"));
 */
export async function notifySlackError(opts: {
  type: string;
  error: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  const contextFields: SlackBlock["fields"] = [];
  if (opts.context) {
    for (const [key, value] of Object.entries(opts.context)) {
      if (value !== undefined && value !== null) {
        contextFields.push({ type: "mrkdwn", text: `*${key}:*\n${String(value)}` });
      }
    }
  }

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `Alert: ${opts.type}`, emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Error:*\n${opts.error}` },
        { type: "mrkdwn", text: `*Timestamp (IST):*\n${timestamp}` },
      ],
    },
  ];

  if (contextFields.length > 0) {
    blocks.push({ type: "section", fields: contextFields });
  }

  await notifySlack({
    attachments: [{ color: "#E01E5A", blocks }],
  });
}

/**
 * Send a new-user signup notification to Slack.
 *
 * Drop-in replacement for the inline notifySlackNewUser that lived in auth.ts.
 */
export async function notifySlackNewUser(newUser: {
  id: string;
  name: string;
  email: string;
  phoneNumber?: string | null;
  createdAt?: Date | null;
}): Promise<void> {
  const phone = newUser.phoneNumber || "N/A";
  const timestamp = newUser.createdAt
    ? new Date(newUser.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    : new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  await notifySlack({
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "New User Signup", emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Phone:*\n${phone}` },
          { type: "mrkdwn", text: `*User ID:*\n${newUser.id}` },
          { type: "mrkdwn", text: `*Signed Up:*\n${timestamp}` },
        ],
      },
    ],
  });
}
