// Discord webhook delivery — DESIGN.md §10. Best-effort: a failed webhook post
// should never fail the request that triggered it.

export async function postDiscord(webhookUrl: string | null | undefined, content: string): Promise<void> {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  } catch {
    // Notifications are a nice-to-have, not load-bearing — swallow errors.
  }
}
