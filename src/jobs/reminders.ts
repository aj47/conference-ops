import type { Bindings } from "../server/env";

const DAY_MS = 86_400_000;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
}

function render(value: string, variables: Record<string, string>) {
  return Object.entries(variables).reduce(
    (result, [key, replacement]) => result.replaceAll(`{{${key}}}`, replacement),
    value,
  );
}

function utcDayBucket(now: number) {
  return new Date(now).toISOString().slice(0, 10);
}

export async function prepareScheduledReminders(env: Bindings, now = Date.now()) {
  await env.DB.prepare(`UPDATE speaker_tasks
    SET status = 'overdue', updated_at = ?
    WHERE status IN ('not_started', 'in_progress') AND due_at < ?`)
    .bind(now, now)
    .run();

  const rules = await env.DB.prepare(`SELECT cs.id, cs.event_id AS eventId, cs.kind, cs.offset_days AS offsetDays,
      e.name AS eventName, e.slug AS eventSlug
    FROM communication_schedules cs
    JOIN events e ON e.id = cs.event_id AND e.deleted_at IS NULL
    WHERE cs.enabled = 1`)
    .all<{ id: string; eventId: string; kind: "task_overdue" | "cfp_draft"; offsetDays: number; eventName: string; eventSlug: string }>();
  let created = 0;
  const bucket = utcDayBucket(now);
  for (const rule of rules.results) {
    if (rule.kind === "task_overdue") {
      const [speakers, template] = await Promise.all([
        env.DB.prepare(`SELECT sp.id, sp.name, sp.email, COUNT(st.id) AS taskCount
          FROM speaker_profiles sp
          JOIN speaker_tasks st ON st.speaker_profile_id = sp.id AND st.event_id = sp.event_id
          WHERE sp.event_id = ? AND st.status = 'overdue' AND st.due_at <= ?
          GROUP BY sp.id, sp.name, sp.email`)
          .bind(rule.eventId, now - Math.max(0, rule.offsetDays) * DAY_MS)
          .all<{ id: string; name: string; email: string; taskCount: number }>(),
        env.DB.prepare("SELECT subject, text, html FROM message_templates WHERE event_id = ? AND kind = 'reminder' ORDER BY updated_at DESC LIMIT 1")
          .bind(rule.eventId).first<{ subject: string; text: string; html: string }>(),
      ]);
      for (const speaker of speakers.results) {
        const portalUrl = new URL("/portal/tasks", env.PUBLIC_APP_URL);
        portalUrl.searchParams.set("eventId", rule.eventId);
        portalUrl.searchParams.set("role", "speaker");
        const variables = {
          "event.name": rule.eventName,
          "speaker.name": speaker.name,
          "task.count": String(speaker.taskCount),
          "speaker.portal_url": portalUrl.toString(),
        };
        const htmlVariables = Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, escapeHtml(value)]));
        const text = render(template?.text ?? "Hi {{speaker.name}}, you have {{task.count}} overdue onboarding task(s) for {{event.name}}. Open your portal: {{speaker.portal_url}}", variables);
        const html = render(template?.html ?? "<p>Hi {{speaker.name}},</p><p>You have {{task.count}} overdue onboarding task(s) for {{event.name}}.</p><p><a href=\"{{speaker.portal_url}}\">Open speaker tasks</a></p>", htmlVariables);
        const idempotencyKey = `scheduled-task-reminder:${rule.eventId}:${speaker.id}:${bucket}`;
        const result = await env.DB.prepare(`INSERT OR IGNORE INTO outbox
          (id, event_id, kind, idempotency_key, payload, status, attempts, available_at, created_at, updated_at)
          VALUES (?, ?, 'email', ?, ?, 'queued', 0, ?, ?, ?)`)
          .bind(crypto.randomUUID(), rule.eventId, idempotencyKey, JSON.stringify({
            kind: "communication",
            eventId: rule.eventId,
            recipient: speaker.email,
            recipientName: speaker.name,
            subject: render(template?.subject ?? "Speaker tasks due · {{event.name}}", variables),
            text,
            html,
          }), now, now, now)
          .run();
        created += result.meta.changes;
      }
    } else {
      const drafts = await env.DB.prepare(`SELECT p.id, p.title, u.name, u.email, sf.closes_at AS closesAt
        FROM proposals p
        JOIN "user" u ON u.id = p.owner_user_id
        JOIN form_versions fv ON fv.id = p.form_version_id
        JOIN submission_forms sf ON sf.id = fv.form_id AND sf.event_id = p.event_id
        WHERE p.event_id = ? AND p.status = 'draft' AND sf.kind = 'cfp' AND sf.status = 'published'
          AND sf.closes_at IS NOT NULL AND sf.closes_at > ? AND sf.closes_at <= ?`)
        .bind(rule.eventId, now, now + Math.max(0, rule.offsetDays) * DAY_MS)
        .all<{ id: string; title: string; name: string; email: string; closesAt: number }>();
      for (const draft of drafts.results) {
        const editUrl = new URL(`/submit/${encodeURIComponent(rule.eventSlug)}`, env.PUBLIC_APP_URL);
        editUrl.searchParams.set("edit", draft.id);
        const closesAt = new Date(Number(draft.closesAt)).toISOString();
        const idempotencyKey = `scheduled-cfp-draft:${rule.eventId}:${draft.id}:${closesAt}`;
        const text = `Hi ${draft.name}, your draft “${draft.title || "Untitled proposal"}” has not been submitted yet. Finish it before the ${rule.eventName} deadline: ${editUrl}`;
        const result = await env.DB.prepare(`INSERT OR IGNORE INTO outbox
          (id, event_id, kind, idempotency_key, payload, status, attempts, available_at, created_at, updated_at)
          VALUES (?, ?, 'email', ?, ?, 'queued', 0, ?, ?, ?)`)
          .bind(crypto.randomUUID(), rule.eventId, idempotencyKey, JSON.stringify({
            kind: "communication",
            eventId: rule.eventId,
            recipient: draft.email,
            recipientName: draft.name,
            subject: `Finish your ${rule.eventName} proposal`,
            text,
            html: `<p>Hi ${escapeHtml(draft.name)},</p><p>Your draft <strong>“${escapeHtml(draft.title || "Untitled proposal")}”</strong> has not been submitted yet.</p><p><a href="${escapeHtml(editUrl.toString())}">Finish the proposal before the deadline</a></p>`,
          }), now, now, now)
          .run();
        created += result.meta.changes;
      }
    }
    await env.DB.prepare("UPDATE communication_schedules SET last_run_at = ?, updated_at = ? WHERE id = ? AND event_id = ?")
      .bind(now, now, rule.id, rule.eventId).run();
  }
  return { created, rules: rules.results.length };
}
