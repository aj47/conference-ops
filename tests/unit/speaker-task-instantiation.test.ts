import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { instantiateAcceptedSpeakerTasksSql } from "../../src/server/speaker-task-instantiation";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 8, 12);
const EVENT_START = NOW + (5 * DAY);

describe("accepted proposal speaker-task instantiation", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE events (id TEXT PRIMARY KEY, starts_at INTEGER NOT NULL);
      CREATE TABLE proposals (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE speaker_profiles (id TEXT PRIMARY KEY, event_id TEXT NOT NULL);
      CREATE TABLE proposal_speakers (proposal_id TEXT NOT NULL, speaker_profile_id TEXT NOT NULL);
      CREATE TABLE task_templates (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        type TEXT NOT NULL,
        target_type TEXT NOT NULL,
        relative_due_days INTEGER NOT NULL,
        external_url TEXT
      );
      CREATE TABLE speaker_tasks (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        template_id TEXT,
        speaker_profile_id TEXT NOT NULL,
        proposal_id TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        external_url TEXT,
        due_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT INTO events VALUES ('event-a', ${EVENT_START}), ('event-b', ${EVENT_START});
      INSERT INTO proposals VALUES
        ('proposal-a', 'event-a', 'accepted'),
        ('proposal-a-2', 'event-a', 'accepted'),
        ('proposal-b', 'event-b', 'accepted'),
        ('proposal-pending', 'event-a', 'under_review');
      INSERT INTO speaker_profiles VALUES
        ('speaker-a', 'event-a'),
        ('speaker-b', 'event-a'),
        ('speaker-other-event', 'event-b');
      INSERT INTO proposal_speakers VALUES
        ('proposal-a', 'speaker-a'),
        ('proposal-a', 'speaker-b'),
        ('proposal-a', 'speaker-other-event'),
        ('proposal-a-2', 'speaker-a'),
        ('proposal-pending', 'speaker-a');
      INSERT INTO task_templates VALUES
        ('template-contact', 'event-a', 'Complete profile', 'Add your public details.', 'profile', 'contact', 2, 'https://conference.example.test/profile'),
        ('template-submission', 'event-a', 'Upload slides', 'Provide the final deck.', 'upload', 'submission', 7, NULL),
        ('template-group', 'event-a', 'Group logistics', 'Unsupported group task.', 'form', 'group', 1, NULL),
        ('template-other-event', 'event-b', 'Other event task', 'Must remain scoped.', 'profile', 'contact', 2, NULL);
    `);
  });

  function instantiate(proposalId = "proposal-a", eventId = "event-a") {
    return db.prepare(instantiateAcceptedSpeakerTasksSql)
      .run(NOW, NOW, NOW, proposalId, eventId);
  }

  it("creates each supported event template for every proposal speaker with computed status and due date", () => {
    expect(instantiate().changes).toBe(4);

    const tasks = db.prepare(`SELECT template_id, speaker_profile_id, proposal_id, status, external_url, due_at
      FROM speaker_tasks ORDER BY template_id, speaker_profile_id`).all();
    expect(tasks).toEqual([
      { template_id: "template-contact", speaker_profile_id: "speaker-a", proposal_id: null, status: "not_started", external_url: "https://conference.example.test/profile", due_at: EVENT_START - (2 * DAY) },
      { template_id: "template-contact", speaker_profile_id: "speaker-b", proposal_id: null, status: "not_started", external_url: "https://conference.example.test/profile", due_at: EVENT_START - (2 * DAY) },
      { template_id: "template-submission", speaker_profile_id: "speaker-a", proposal_id: "proposal-a", status: "overdue", external_url: null, due_at: EVENT_START - (7 * DAY) },
      { template_id: "template-submission", speaker_profile_id: "speaker-b", proposal_id: "proposal-a", status: "overdue", external_url: null, due_at: EVENT_START - (7 * DAY) },
    ]);
  });

  it("creates contact work once and submission work per accepted proposal, idempotently", () => {
    expect(instantiate().changes).toBe(4);
    expect(instantiate().changes).toBe(0);
    expect(instantiate("proposal-a-2").changes).toBe(1);
    expect(instantiate("proposal-a-2").changes).toBe(0);

    expect(db.prepare(`SELECT template_id, speaker_profile_id, proposal_id
      FROM speaker_tasks WHERE speaker_profile_id = 'speaker-a'
      ORDER BY template_id, proposal_id`).all()).toEqual([
      { template_id: "template-contact", speaker_profile_id: "speaker-a", proposal_id: null },
      { template_id: "template-submission", speaker_profile_id: "speaker-a", proposal_id: "proposal-a" },
      { template_id: "template-submission", speaker_profile_id: "speaker-a", proposal_id: "proposal-a-2" },
    ]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM speaker_tasks").get()).toEqual({ count: 5 });
  });

  it("requires an accepted proposal in the requested event and ignores cross-event speakers", () => {
    expect(instantiate("proposal-a", "event-b").changes).toBe(0);
    expect(instantiate("proposal-pending", "event-a").changes).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM speaker_tasks").get()).toEqual({ count: 0 });
  });

  it("snapshots an external action URL so later template edits do not redirect assigned work", () => {
    expect(instantiate().changes).toBe(4);
    db.prepare("UPDATE task_templates SET external_url = 'https://malicious.example.test/changed' WHERE id = 'template-contact'").run();

    expect(db.prepare("SELECT DISTINCT external_url FROM speaker_tasks WHERE template_id = 'template-contact'").all()).toEqual([
      { external_url: "https://conference.example.test/profile" },
    ]);
  });
});
