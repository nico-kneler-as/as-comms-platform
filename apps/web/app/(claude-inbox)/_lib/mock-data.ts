/**
 * Claude Inbox prototype — server-only mock fixtures.
 *
 * This module is the single source of truth for the prototype's rendered
 * content. It is imported only by Server Components so that the client never
 * receives the raw fixture map — the client only sees the minimized view
 * models returned by the selectors.
 *
 * Phase 2 will swap these factories for real repository reads against the
 * canonical inbox/timeline projections without changing view-model shapes.
 */

import type {
  ClaudeAvatarTone,
  ClaudeInboxBucket,
  ClaudeInboxChannel,
  ClaudeProjectMembershipViewModel,
  ClaudeTimelineEntryKind,
  ClaudeTimelineEntryViewModel,
  ClaudeVolunteerStage
} from "./view-models.js";

interface MockContactRecord {
  readonly contactId: string;
  readonly displayName: string;
  readonly initials: string;
  readonly avatarTone: ClaudeAvatarTone;
  readonly volunteerStage: ClaudeVolunteerStage;
  readonly primaryEmail: string | null;
  readonly primaryPhone: string | null;
  readonly location: string | null;
  readonly joinedAtLabel: string;
  readonly salesforceLinked: boolean;
  readonly projects: readonly ClaudeProjectMembershipViewModel[];
  readonly bucket: ClaudeInboxBucket;
  readonly isStarred: boolean;
  readonly hasUnresolved: boolean;
  readonly unreadCount: number;
  readonly latestSubject: string;
  readonly snippet: string;
  readonly latestChannel: ClaudeInboxChannel;
  readonly projectLabel: string | null;
  readonly lastActivityAt: string;
  readonly lastActivityLabel: string;
  readonly timeline: readonly ClaudeTimelineEntryViewModel[];
}

const CONTACTS: readonly MockContactRecord[] = [
  {
    contactId: "c_maya_patel",
    displayName: "Maya Patel",
    initials: "MP",
    avatarTone: "indigo",
    volunteerStage: "active",
    primaryEmail: "maya.patel@example.org",
    primaryPhone: "+1 303 555 0142",
    location: "Boulder, CO",
    joinedAtLabel: "Joined Mar 2024",
    salesforceLinked: true,
    projects: [
      {
        projectId: "p_wolverine_2025",
        projectName: "Wolverine Watch 2025",
        role: "Field volunteer",
        status: "Confirmed"
      }
    ],
    bucket: "new",
    isStarred: true,
    hasUnresolved: false,
    unreadCount: 2,
    latestSubject: "Re: Wolverine Watch — training confirmation",
    snippet:
      "Hi team — just confirming I can make the April 22 training. Is there a kit list I should…",
    latestChannel: "email",
    projectLabel: "Wolverine Watch 2025",
    lastActivityAt: "2026-04-14T14:22:00Z",
    lastActivityLabel: "9:22 AM",
    timeline: buildTimeline("c_maya_patel", [
      {
        kind: "outbound-email",
        actor: "Jordan (you)",
        subject: "Wolverine Watch — training confirmation",
        body:
          "Hi Maya, attaching the April 22 agenda and the recommended kit list. Let us know if you need a carpool from Boulder.",
        daysAgo: 4,
        isUnread: false
      },
      {
        kind: "inbound-email",
        actor: "Maya Patel",
        subject: "Re: Wolverine Watch — training confirmation",
        body:
          "Hi team — just confirming I can make the April 22 training. Is there a kit list I should review beforehand? Also, is there a carpool from Boulder?",
        daysAgo: 0,
        isUnread: true
      },
      {
        kind: "internal-note",
        actor: "Jordan",
        body:
          "Maya is a strong candidate for the extended Wind River route. Wants carpool — check with Elena.",
        daysAgo: 0,
        isUnread: false
      }
    ])
  },
  {
    contactId: "c_daniel_rivers",
    displayName: "Daniel Rivers",
    initials: "DR",
    avatarTone: "emerald",
    volunteerStage: "applicant",
    primaryEmail: "d.rivers@example.com",
    primaryPhone: null,
    location: "Bozeman, MT",
    joinedAtLabel: "Applied Apr 2026",
    salesforceLinked: true,
    projects: [
      {
        projectId: "p_pika_alpine",
        projectName: "Alpine Pika Survey",
        role: "Applicant",
        status: "Pending review"
      }
    ],
    bucket: "new",
    isStarred: false,
    hasUnresolved: false,
    unreadCount: 1,
    latestSubject: "Alpine Pika Survey application",
    snippet:
      "Hi — I submitted the application last week and wanted to check if there's anything else you need from me.",
    latestChannel: "email",
    projectLabel: "Alpine Pika Survey",
    lastActivityAt: "2026-04-14T12:05:00Z",
    lastActivityLabel: "7:05 AM",
    timeline: buildTimeline("c_daniel_rivers", [
      {
        kind: "inbound-email",
        actor: "Daniel Rivers",
        subject: "Alpine Pika Survey application",
        body:
          "Hi — I submitted the application last week and wanted to check if there's anything else you need from me. Happy to provide references if that helps.",
        daysAgo: 0,
        isUnread: true
      },
      {
        kind: "system-event",
        actor: "System",
        body: "Application received for Alpine Pika Survey.",
        daysAgo: 6,
        isUnread: false
      }
    ])
  },
  {
    contactId: "c_priya_chen",
    displayName: "Priya Chen",
    initials: "PC",
    avatarTone: "violet",
    volunteerStage: "active",
    primaryEmail: "priya.chen@example.org",
    primaryPhone: "+1 415 555 0119",
    location: "San Francisco, CA",
    joinedAtLabel: "Joined Aug 2023",
    salesforceLinked: true,
    projects: [
      {
        projectId: "p_coastal_kelp",
        projectName: "Coastal Kelp Monitoring",
        role: "Field lead",
        status: "Active"
      }
    ],
    bucket: "new",
    isStarred: false,
    hasUnresolved: true,
    unreadCount: 1,
    latestSubject: "Site access permit — urgent",
    snippet:
      "Got word the Duxbury Reef permit isn't in the system. Can someone confirm by Wednesday?",
    latestChannel: "email",
    projectLabel: "Coastal Kelp Monitoring",
    lastActivityAt: "2026-04-14T09:48:00Z",
    lastActivityLabel: "4:48 AM",
    timeline: buildTimeline("c_priya_chen", [
      {
        kind: "inbound-email",
        actor: "Priya Chen",
        subject: "Site access permit — urgent",
        body:
          "Hi — got word from the ranger that the Duxbury Reef permit isn't in the system yet. Can someone on the AS side confirm by Wednesday? We're holding gear in Oakland.",
        daysAgo: 0,
        isUnread: true
      },
      {
        kind: "system-event",
        actor: "System",
        body:
          "Routing review opened: permit ownership unclear between Coastal Kelp and Bay Estuary projects.",
        daysAgo: 0,
        isUnread: false
      },
      {
        kind: "campaign-event",
        actor: "Campaign: April field readiness",
        body: "Campaign email delivered.",
        daysAgo: 2,
        isUnread: false
      }
    ])
  },
  {
    contactId: "c_sam_whitehorse",
    displayName: "Sam Whitehorse",
    initials: "SW",
    avatarTone: "amber",
    volunteerStage: "active",
    primaryEmail: "sam.w@example.net",
    primaryPhone: "+1 406 555 0193",
    location: "Missoula, MT",
    joinedAtLabel: "Joined Jun 2022",
    salesforceLinked: true,
    projects: [
      {
        projectId: "p_river_otter",
        projectName: "River Otter Distribution",
        role: "Field volunteer",
        status: "Active"
      }
    ],
    bucket: "opened",
    isStarred: true,
    hasUnresolved: false,
    unreadCount: 0,
    latestSubject: "Data upload questions",
    snippet:
      "Thanks — the sync worked after I switched networks. Closing this one out unless you need more.",
    latestChannel: "email",
    projectLabel: "River Otter Distribution",
    lastActivityAt: "2026-04-13T19:30:00Z",
    lastActivityLabel: "Yesterday",
    timeline: buildTimeline("c_sam_whitehorse", [
      {
        kind: "inbound-email",
        actor: "Sam Whitehorse",
        subject: "Data upload questions",
        body:
          "Thanks — the sync worked after I switched networks. Closing this one out unless you need more from me.",
        daysAgo: 1,
        isUnread: false
      },
      {
        kind: "outbound-email",
        actor: "Jordan (you)",
        subject: "Re: Data upload questions",
        body:
          "Glad that worked. I'll mark the last two sessions as received. Let us know when May upload window opens.",
        daysAgo: 1,
        isUnread: false
      }
    ])
  },
  {
    contactId: "c_anita_ross",
    displayName: "Anita Ross",
    initials: "AR",
    avatarTone: "rose",
    volunteerStage: "prospect",
    primaryEmail: "anita.ross@example.edu",
    primaryPhone: "+1 802 555 0178",
    location: "Burlington, VT",
    joinedAtLabel: "First contact Apr 2026",
    salesforceLinked: false,
    projects: [],
    bucket: "new",
    isStarred: false,
    hasUnresolved: true,
    unreadCount: 1,
    latestSubject: "Question from Middlebury bio dept",
    snippet:
      "I teach field ecology at Middlebury and would love to connect volunteers to our capstone…",
    latestChannel: "email",
    projectLabel: null,
    lastActivityAt: "2026-04-14T02:14:00Z",
    lastActivityLabel: "Yesterday",
    timeline: buildTimeline("c_anita_ross", [
      {
        kind: "inbound-email",
        actor: "Anita Ross",
        subject: "Question from Middlebury bio dept",
        body:
          "Hi — I teach field ecology at Middlebury and would love to connect volunteers to our spring capstone. Do you have a partnership contact?",
        daysAgo: 1,
        isUnread: true
      }
    ])
  },
  {
    contactId: "c_ben_okafor",
    displayName: "Ben Okafor",
    initials: "BO",
    avatarTone: "sky",
    volunteerStage: "alumni",
    primaryEmail: "ben.okafor@example.com",
    primaryPhone: "+1 720 555 0111",
    location: "Denver, CO",
    joinedAtLabel: "Alumni since 2024",
    salesforceLinked: true,
    projects: [
      {
        projectId: "p_raptor_migration",
        projectName: "Raptor Migration 2023",
        role: "Alumni volunteer",
        status: "Completed"
      }
    ],
    bucket: "opened",
    isStarred: false,
    hasUnresolved: false,
    unreadCount: 0,
    latestSubject: "Photo permissions for annual report",
    snippet:
      "Of course — use any of the 2023 Raptor photos. Credit line is fine, no logo needed.",
    latestChannel: "email",
    projectLabel: "Raptor Migration 2023",
    lastActivityAt: "2026-04-12T16:10:00Z",
    lastActivityLabel: "2 days ago",
    timeline: buildTimeline("c_ben_okafor", [
      {
        kind: "outbound-email",
        actor: "Jordan (you)",
        subject: "Photo permissions for annual report",
        body:
          "Hi Ben — can we use a few of your 2023 raptor photos in the annual report? Full credit, of course.",
        daysAgo: 3,
        isUnread: false
      },
      {
        kind: "inbound-email",
        actor: "Ben Okafor",
        subject: "Re: Photo permissions for annual report",
        body: "Of course — use any of the 2023 Raptor photos. Credit line is fine, no logo needed.",
        daysAgo: 2,
        isUnread: false
      }
    ])
  },
  {
    contactId: "c_elena_marquez",
    displayName: "Elena Marquez",
    initials: "EM",
    avatarTone: "teal",
    volunteerStage: "active",
    primaryEmail: "elena.m@example.org",
    primaryPhone: "+1 505 555 0157",
    location: "Santa Fe, NM",
    joinedAtLabel: "Joined Feb 2025",
    salesforceLinked: true,
    projects: [
      {
        projectId: "p_wolverine_2025",
        projectName: "Wolverine Watch 2025",
        role: "Regional coordinator",
        status: "Active"
      }
    ],
    bucket: "opened",
    isStarred: true,
    hasUnresolved: false,
    unreadCount: 0,
    latestSubject: "Carpool list for April training",
    snippet:
      "I can pick up two from Boulder on the 22nd — just need names by Friday.",
    latestChannel: "sms",
    projectLabel: "Wolverine Watch 2025",
    lastActivityAt: "2026-04-12T11:02:00Z",
    lastActivityLabel: "2 days ago",
    timeline: buildTimeline("c_elena_marquez", [
      {
        kind: "inbound-sms",
        actor: "Elena Marquez",
        subject: null,
        body: "I can pick up two from Boulder on the 22nd — just need names by Friday.",
        daysAgo: 2,
        isUnread: false
      },
      {
        kind: "outbound-sms",
        actor: "Jordan (you)",
        subject: null,
        body: "Perfect. I'll circle back with the list Thursday evening.",
        daysAgo: 2,
        isUnread: false
      }
    ])
  },
  {
    contactId: "c_unknown_5551",
    displayName: "+1 720 555 0199",
    initials: "??",
    avatarTone: "slate",
    volunteerStage: "non-volunteer",
    primaryEmail: null,
    primaryPhone: "+1 720 555 0199",
    location: null,
    joinedAtLabel: "First seen Apr 2026",
    salesforceLinked: false,
    projects: [],
    bucket: "new",
    isStarred: false,
    hasUnresolved: true,
    unreadCount: 1,
    latestSubject: "Inbound SMS",
    snippet:
      "hey is this the wolverine signup line? my wife saw the flyer in laramie",
    latestChannel: "sms",
    projectLabel: null,
    lastActivityAt: "2026-04-13T22:45:00Z",
    lastActivityLabel: "Yesterday",
    timeline: buildTimeline("c_unknown_5551", [
      {
        kind: "inbound-sms",
        actor: "+1 720 555 0199",
        subject: null,
        body:
          "hey is this the wolverine signup line? my wife saw the flyer in laramie",
        daysAgo: 1,
        isUnread: true
      },
      {
        kind: "system-event",
        actor: "System",
        body:
          "Identity resolution queue: no contact match for +1 720 555 0199. Awaiting manual link.",
        daysAgo: 1,
        isUnread: false
      }
    ])
  }
];

interface MockTimelineSeed {
  readonly kind: ClaudeTimelineEntryKind;
  readonly actor: string;
  readonly subject?: string | null;
  readonly body: string;
  readonly daysAgo: number;
  readonly isUnread: boolean;
}

function buildTimeline(
  contactId: string,
  seeds: readonly MockTimelineSeed[]
): readonly ClaudeTimelineEntryViewModel[] {
  return seeds.map((seed, index) => {
    const occurredAt = iso(seed.daysAgo);
    return {
      id: `${contactId}_t${index.toString()}`,
      kind: seed.kind,
      occurredAt,
      occurredAtLabel: relativeLabel(seed.daysAgo),
      actorLabel: seed.actor,
      subject: seed.subject ?? null,
      body: seed.body,
      channel: channelForKind(seed.kind),
      isUnread: seed.isUnread
    };
  });
}

function channelForKind(kind: ClaudeTimelineEntryKind): ClaudeInboxChannel | null {
  switch (kind) {
    case "inbound-email":
    case "outbound-email":
      return "email";
    case "inbound-sms":
    case "outbound-sms":
      return "sms";
    default:
      return null;
  }
}

function iso(daysAgo: number): string {
  const base = Date.UTC(2026, 3, 14, 14, 0, 0);
  const offsetMs = daysAgo * 24 * 60 * 60 * 1000;
  return new Date(base - offsetMs).toISOString();
}

function relativeLabel(daysAgo: number): string {
  if (daysAgo === 0) return "today";
  if (daysAgo === 1) return "yesterday";
  if (daysAgo < 7) return `${daysAgo.toString()} days ago`;
  if (daysAgo < 14) return "last week";
  return `${Math.floor(daysAgo / 7).toString()} weeks ago`;
}

export function getMockContacts(): readonly MockContactRecord[] {
  return CONTACTS;
}

export function getMockContactById(
  contactId: string
): MockContactRecord | null {
  return CONTACTS.find((c) => c.contactId === contactId) ?? null;
}

export type { MockContactRecord };
