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
  ClaudeProjectStatus,
  ClaudeTimelineEntryKind,
  ClaudeTimelineEntryViewModel,
  ClaudeVolunteerStage
} from "./view-models";

export type VolunteerMilestoneKind =
  | "signed-up"
  | "training-received"
  | "training-completed"
  | "trip-plan-submitted"
  | "first-record-submitted";

interface MockMilestone {
  readonly id: string;
  readonly kind: VolunteerMilestoneKind;
  readonly projectName: string;
  readonly daysAgo: number;
}

interface MockContactRecord {
  readonly contactId: string;
  readonly volunteerId: string;
  readonly displayName: string;
  readonly initials: string;
  readonly avatarTone: ClaudeAvatarTone;
  readonly volunteerStage: ClaudeVolunteerStage;
  readonly primaryEmail: string | null;
  readonly primaryPhone: string | null;
  readonly cityState: string | null;
  readonly joinedAtLabel: string;
  readonly activeProjects: readonly ClaudeProjectMembershipViewModel[];
  readonly pastProjects: readonly ClaudeProjectMembershipViewModel[];
  readonly milestones: readonly MockMilestone[];
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

function membership(
  projectId: string,
  projectName: string,
  year: number,
  status: ClaudeProjectStatus
): ClaudeProjectMembershipViewModel {
  return {
    membershipId: `m_${projectId}_${year.toString()}`,
    projectId,
    projectName,
    year,
    status,
    crmUrl: `https://crm.example.org/participations/${projectId}-${year.toString()}`
  };
}

const CONTACTS: readonly MockContactRecord[] = [
  {
    contactId: "c_maya_patel",
    volunteerId: "10428",
    displayName: "Maya Patel",
    initials: "MP",
    avatarTone: "indigo",
    volunteerStage: "active",
    primaryEmail: "maya.patel@example.org",
    primaryPhone: "+1 303 555 0142",
    cityState: "Boulder, CO",
    joinedAtLabel: "Joined Mar 2024",
    activeProjects: [
      membership("wolverine-watch", "Wolverine Watch", 2025, "in-training")
    ],
    pastProjects: [
      membership("alpine-pika", "Alpine Pika Survey", 2024, "successful"),
      membership("raptor-migration", "Raptor Migration", 2023, "successful")
    ],
    milestones: [
      {
        id: "ms_maya_1",
        kind: "signed-up",
        projectName: "Wolverine Watch",
        daysAgo: 18
      },
      {
        id: "ms_maya_2",
        kind: "training-received",
        projectName: "Wolverine Watch",
        daysAgo: 6
      },
      {
        id: "ms_maya_3",
        kind: "first-record-submitted",
        projectName: "Alpine Pika Survey",
        daysAgo: 210
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
        kind: "outbound-campaign-email",
        actor: "Campaigns",
        subject: "Spring 2026 Field Season Kickoff",
        body:
          "Spring field work is starting soon! This season we're launching Wolverine Watch 2025 alongside the returning Alpine Pika Survey. If you've volunteered with us before and want to get back in the field this year, reply to this email and we'll get you set up for our April training weekend.",
        daysAgo: 42,
        isUnread: false
      },
      {
        kind: "inbound-email",
        actor: "Maya Patel",
        subject: "Re: Spring 2026 Field Season Kickoff",
        body:
          "Hi team — I'd love to help out this year. Alpine Pika was one of the best things I did in 2024 and I saw you're launching a wolverine project. Happy to do either, or both if you need coverage.",
        daysAgo: 40,
        isUnread: false
      },
      {
        kind: "outbound-email",
        actor: "Jordan (you)",
        subject: "Re: Spring 2026 Field Season Kickoff",
        body:
          "Maya — so glad you're back for another season. Wolverine Watch would be a great fit for you given your Alpine Pika experience. The April 22 training in Boulder is the next step. Can I put you down for that?",
        daysAgo: 39,
        isUnread: false
      },
      {
        kind: "inbound-email",
        actor: "Maya Patel",
        subject: "Re: Spring 2026 Field Season Kickoff",
        body: "Yes please! Put me down for April 22.",
        daysAgo: 38,
        isUnread: false
      },
      {
        kind: "outbound-auto-email",
        actor: "System",
        subject: "You're signed up: Wolverine Watch 2025 training",
        body:
          "This is a confirmation that Maya Patel has been added to the Wolverine Watch 2025 training roster for April 22. Training location, parking, and a recommended kit list will be sent one week before the session. If you need to cancel or reschedule, reply to this email or call (303) 555-0100.",
        daysAgo: 38,
        isUnread: false
      },
      {
        kind: "system-event",
        actor: "System",
        body: "Signed up for Wolverine Watch 2025",
        daysAgo: 38,
        isUnread: false
      },
      {
        kind: "outbound-auto-email",
        actor: "System",
        subject: "Reminder: your Wolverine Watch training is in 1 week",
        body:
          "Just a reminder that the Wolverine Watch 2025 volunteer training is next Wednesday, April 22 at 9am at the Boulder field office. Please bring the kit listed below and plan for an all-day session. Carpools from Denver and Fort Collins are being coordinated in the volunteer Slack.",
        daysAgo: 8,
        isUnread: false
      },
      {
        kind: "system-event",
        actor: "System",
        body: "Received training materials for Wolverine Watch 2025",
        daysAgo: 6,
        isUnread: false
      },
      {
        kind: "outbound-email",
        actor: "Jordan (you)",
        subject: "Wolverine Watch — training confirmation",
        body:
          "Hi Maya, attaching the April 22 agenda and the recommended kit list. Let us know if you need a carpool from Boulder — Elena in Santa Fe is coordinating a pickup on I-70.",
        daysAgo: 4,
        isUnread: false
      },
      {
        kind: "inbound-email",
        actor: "Maya Patel",
        subject: "Re: Wolverine Watch — training confirmation",
        body:
          "Hi team — just confirming I can make the April 22 training. Is there a kit list I should review beforehand? Also, is there a carpool from Boulder? I can drive but I'd rather not if someone's already heading out.",
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
    volunteerId: "10651",
    displayName: "Daniel Rivers",
    initials: "DR",
    avatarTone: "emerald",
    volunteerStage: "applicant",
    primaryEmail: "d.rivers@example.com",
    primaryPhone: null,
    cityState: "Bozeman, MT",
    joinedAtLabel: "Joined Apr 2026",
    activeProjects: [
      membership("alpine-pika", "Alpine Pika Survey", 2026, "applied")
    ],
    pastProjects: [],
    milestones: [
      {
        id: "ms_daniel_1",
        kind: "signed-up",
        projectName: "Alpine Pika Survey",
        daysAgo: 7
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
        kind: "outbound-campaign-email",
        actor: "Campaigns",
        subject: "Volunteers needed — Alpine Pika Survey 2026",
        body:
          "We're recruiting field volunteers for the 2026 Alpine Pika Survey in the northern Rockies. No prior experience required; we provide training in mid-May before the first field window opens. If you're interested, click through to apply.",
        daysAgo: 14,
        isUnread: false
      },
      {
        kind: "inbound-email",
        actor: "Daniel Rivers",
        subject: "Alpine Pika Survey — interested",
        body:
          "Hi, I saw your email about the pika survey and I'm very interested. I've done birding transects with MT Audubon so I'm comfortable with data sheets and GPS, but this would be my first project with Adventure Scientists. Where do I start?",
        daysAgo: 12,
        isUnread: false
      },
      {
        kind: "outbound-email",
        actor: "Jordan (you)",
        subject: "Re: Alpine Pika Survey — interested",
        body:
          "Hi Daniel, welcome! The next step is filling out the full application (takes about 15 minutes) — link below. Once that's in we'll confirm fit and schedule you for training.",
        daysAgo: 12,
        isUnread: false
      },
      {
        kind: "system-event",
        actor: "System",
        body: "Signed up for Alpine Pika Survey",
        daysAgo: 7,
        isUnread: false
      },
      {
        kind: "outbound-auto-email",
        actor: "System",
        subject: "Application received: Alpine Pika Survey",
        body:
          "Thanks for applying to the Alpine Pika Survey. A project coordinator will review your application within 5 business days and reach out with next steps. You'll hear from us by April 19.",
        daysAgo: 7,
        isUnread: false
      },
      {
        kind: "inbound-email",
        actor: "Daniel Rivers",
        subject: "Alpine Pika Survey application",
        body:
          "Hi — I submitted the application last week and wanted to check if there's anything else you need from me. Happy to provide references if that helps.",
        daysAgo: 0,
        isUnread: true
      }
    ])
  },
  {
    contactId: "c_priya_chen",
    volunteerId: "9842",
    displayName: "Priya Chen",
    initials: "PC",
    avatarTone: "violet",
    volunteerStage: "active",
    primaryEmail: "priya.chen@example.org",
    primaryPhone: "+1 415 555 0119",
    cityState: "San Francisco, CA",
    joinedAtLabel: "Joined Aug 2023",
    activeProjects: [
      membership("coastal-kelp", "Coastal Kelp Monitoring", 2026, "in-field")
    ],
    pastProjects: [
      membership("coastal-kelp", "Coastal Kelp Monitoring", 2025, "successful"),
      membership("coastal-kelp", "Coastal Kelp Monitoring", 2024, "successful"),
      membership("bay-estuary", "Bay Estuary Baseline", 2023, "successful")
    ],
    milestones: [
      {
        id: "ms_priya_1",
        kind: "signed-up",
        projectName: "Coastal Kelp Monitoring",
        daysAgo: 90
      },
      {
        id: "ms_priya_2",
        kind: "training-completed",
        projectName: "Coastal Kelp Monitoring",
        daysAgo: 60
      },
      {
        id: "ms_priya_3",
        kind: "trip-plan-submitted",
        projectName: "Coastal Kelp Monitoring",
        daysAgo: 12
      },
      {
        id: "ms_priya_4",
        kind: "first-record-submitted",
        projectName: "Coastal Kelp Monitoring",
        daysAgo: 4
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
        kind: "outbound-auto-email",
        actor: "System",
        subject: "Trip plan approved: Duxbury Reef, Apr 15–17",
        body:
          "Your trip plan for Duxbury Reef has been approved. Please remember to check in at the start and end of each field day via the volunteer app. Tides and access notes are attached.",
        daysAgo: 12,
        isUnread: false
      },
      {
        kind: "outbound-campaign-sms",
        actor: "Campaigns",
        subject: "April field readiness SMS",
        body:
          "Coastal Kelp volunteers: reminder that your April field window opens Monday. Check the project app for your assigned quadrats and reply STOP to opt out of project texts.",
        daysAgo: 6,
        isUnread: false
      },
      {
        kind: "outbound-email",
        actor: "Jordan (you)",
        subject: "Welcome back for the 2026 kelp season",
        body:
          "Priya — so glad to have you back on Coastal Kelp for a third year. You're locked in as field lead for Duxbury Reef. Let me know if anything on the gear list is missing from last year's kit.",
        daysAgo: 5,
        isUnread: false
      },
      {
        kind: "inbound-email",
        actor: "Priya Chen",
        subject: "Re: Welcome back for the 2026 kelp season",
        body:
          "Thanks Jordan! Kit is in good shape. I submitted the first quadrat record this morning — looks healthy out there compared to last year. Will send the rest by Friday.",
        daysAgo: 4,
        isUnread: false
      },
      {
        kind: "system-event",
        actor: "System",
        body: "Submitted first record for Coastal Kelp Monitoring",
        daysAgo: 4,
        isUnread: false
      },
      {
        kind: "inbound-sms",
        actor: "Priya Chen",
        subject: null,
        body:
          "Heads up — ranger just told me Duxbury permit isn't showing in their system. We good?",
        daysAgo: 1,
        isUnread: false
      },
      {
        kind: "outbound-sms",
        actor: "Jordan (you)",
        subject: null,
        body:
          "Checking with the permits team now — I'll have an answer for you by EOD.",
        daysAgo: 1,
        isUnread: false
      },
      {
        kind: "inbound-email",
        actor: "Priya Chen",
        subject: "Site access permit — urgent",
        body:
          "Hi — got word from the ranger that the Duxbury Reef permit isn't in the system yet. Can someone on the AS side confirm by Wednesday? We're holding gear in Oakland and I'd hate to reschedule the crew.",
        daysAgo: 0,
        isUnread: true
      },
      {
        kind: "internal-note",
        actor: "Jordan",
        body:
          "Routing: permit was approved in March but never synced to GGNRA system. Looping in Mel from ops.",
        daysAgo: 0,
        isUnread: false
      },
      {
        kind: "system-event",
        actor: "System",
        body:
          "Routing review opened: permit ownership unclear between Coastal Kelp and Bay Estuary projects.",
        daysAgo: 0,
        isUnread: false
      }
    ])
  },
  {
    contactId: "c_sam_whitehorse",
    volunteerId: "8127",
    displayName: "Sam Whitehorse",
    initials: "SW",
    avatarTone: "amber",
    volunteerStage: "active",
    primaryEmail: "sam.w@example.net",
    primaryPhone: "+1 406 555 0193",
    cityState: "Missoula, MT",
    joinedAtLabel: "Joined Jun 2022",
    activeProjects: [
      membership("river-otter", "River Otter Distribution", 2026, "in-field")
    ],
    pastProjects: [
      membership("river-otter", "River Otter Distribution", 2025, "successful"),
      membership("river-otter", "River Otter Distribution", 2024, "successful"),
      membership("bull-trout", "Bull Trout eDNA", 2023, "successful"),
      membership("bull-trout", "Bull Trout eDNA", 2022, "successful")
    ],
    milestones: [
      {
        id: "ms_sam_1",
        kind: "signed-up",
        projectName: "River Otter Distribution",
        daysAgo: 95
      },
      {
        id: "ms_sam_2",
        kind: "training-completed",
        projectName: "River Otter Distribution",
        daysAgo: 70
      },
      {
        id: "ms_sam_3",
        kind: "trip-plan-submitted",
        projectName: "River Otter Distribution",
        daysAgo: 28
      },
      {
        id: "ms_sam_4",
        kind: "first-record-submitted",
        projectName: "River Otter Distribution",
        daysAgo: 10
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
        kind: "outbound-email",
        actor: "Jordan (you)",
        subject: "2026 River Otter field window is open",
        body:
          "Sam — the April field window for River Otter is officially open. Your assigned transects are the same as last year (Blackfoot upper + middle). Let us know if anything has changed on your end.",
        daysAgo: 14,
        isUnread: false
      },
      {
        kind: "inbound-email",
        actor: "Sam Whitehorse",
        subject: "Re: 2026 River Otter field window is open",
        body:
          "Perfect, same transects work. Already got the kit out of storage. Will file the trip plan this week.",
        daysAgo: 13,
        isUnread: false
      },
      {
        kind: "system-event",
        actor: "System",
        body: "Submitted trip plan for River Otter Distribution",
        daysAgo: 12,
        isUnread: false
      },
      {
        kind: "outbound-auto-email",
        actor: "System",
        subject: "Trip plan approved: Blackfoot River, Apr 4–6",
        body:
          "Your trip plan has been reviewed and approved. Remember to carry the emergency contact card and check in at start and end of each field day.",
        daysAgo: 11,
        isUnread: false
      },
      {
        kind: "system-event",
        actor: "System",
        body: "Submitted first record for River Otter Distribution",
        daysAgo: 10,
        isUnread: false
      },
      {
        kind: "inbound-sms",
        actor: "Sam Whitehorse",
        subject: null,
        body:
          "Upload keeps failing at the last step — 'network error'. Trying from the truck hotspot.",
        daysAgo: 2,
        isUnread: false
      },
      {
        kind: "outbound-sms",
        actor: "Jordan (you)",
        subject: null,
        body:
          "The hotspot usually does it — also try airplane-mode toggle once. Let me know if it still fails.",
        daysAgo: 2,
        isUnread: false
      },
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
    volunteerId: "10892",
    displayName: "Anita Ross",
    initials: "AR",
    avatarTone: "rose",
    volunteerStage: "prospect",
    primaryEmail: "anita.ross@example.edu",
    primaryPhone: "+1 802 555 0178",
    cityState: "Burlington, VT",
    joinedAtLabel: "Joined Apr 2026",
    activeProjects: [],
    pastProjects: [],
    milestones: [],
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
          "Hi — I teach field ecology at Middlebury and would love to connect volunteers to our spring capstone. Do you have a partnership contact, or should I just send students to the general volunteer form? Happy to jump on a call if that's easier.",
        daysAgo: 1,
        isUnread: true
      }
    ])
  },
  {
    contactId: "c_ben_okafor",
    volunteerId: "7214",
    displayName: "Ben Okafor",
    initials: "BO",
    avatarTone: "sky",
    volunteerStage: "alumni",
    primaryEmail: "ben.okafor@example.com",
    primaryPhone: "+1 720 555 0111",
    cityState: "Denver, CO",
    joinedAtLabel: "Joined Mar 2021",
    activeProjects: [],
    pastProjects: [
      membership("raptor-migration", "Raptor Migration", 2023, "successful"),
      membership("raptor-migration", "Raptor Migration", 2022, "successful"),
      membership("raptor-migration", "Raptor Migration", 2021, "successful")
    ],
    milestones: [
      {
        id: "ms_ben_1",
        kind: "first-record-submitted",
        projectName: "Raptor Migration",
        daysAgo: 900
      },
      {
        id: "ms_ben_2",
        kind: "trip-plan-submitted",
        projectName: "Raptor Migration",
        daysAgo: 920
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
        kind: "outbound-campaign-email",
        actor: "Campaigns",
        subject: "2025 Annual Report — a look back at your field work",
        body:
          "This year's annual report features volunteer photographers and the stories behind the data. If you have field photos from past seasons that we can feature, reply to let us know. Your contribution makes this report possible.",
        daysAgo: 10,
        isUnread: false
      },
      {
        kind: "outbound-email",
        actor: "Jordan (you)",
        subject: "Photo permissions for annual report",
        body:
          "Hi Ben — can we use a few of your 2023 raptor photos in the annual report? Full credit, of course. The drafts we want to feature are the four silhouettes from Lookout Mountain and the spread at Dinosaur Ridge.",
        daysAgo: 3,
        isUnread: false
      },
      {
        kind: "inbound-email",
        actor: "Ben Okafor",
        subject: "Re: Photo permissions for annual report",
        body:
          "Of course — use any of the 2023 Raptor photos. Credit line is fine, no logo needed. Glad they'll get another life.",
        daysAgo: 2,
        isUnread: false
      }
    ])
  },
  {
    contactId: "c_elena_marquez",
    volunteerId: "9507",
    displayName: "Elena Marquez",
    initials: "EM",
    avatarTone: "teal",
    volunteerStage: "active",
    primaryEmail: "elena.m@example.org",
    primaryPhone: "+1 505 555 0157",
    cityState: "Santa Fe, NM",
    joinedAtLabel: "Joined Feb 2025",
    activeProjects: [
      membership("wolverine-watch", "Wolverine Watch", 2025, "trip-planning")
    ],
    pastProjects: [
      membership("wolverine-watch", "Wolverine Watch", 2024, "successful")
    ],
    milestones: [
      {
        id: "ms_elena_1",
        kind: "signed-up",
        projectName: "Wolverine Watch",
        daysAgo: 45
      },
      {
        id: "ms_elena_2",
        kind: "training-completed",
        projectName: "Wolverine Watch",
        daysAgo: 20
      },
      {
        id: "ms_elena_3",
        kind: "trip-plan-submitted",
        projectName: "Wolverine Watch",
        daysAgo: 5
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
        kind: "outbound-campaign-email",
        actor: "Campaigns",
        subject: "Wolverine Watch 2025 kickoff",
        body:
          "Returning Wolverine Watch volunteers: this year's project expands into the Wind River range. If you're on the 2024 roster, you're already approved for 2025 — just reply to confirm your availability.",
        daysAgo: 50,
        isUnread: false
      },
      {
        kind: "inbound-email",
        actor: "Elena Marquez",
        subject: "Re: Wolverine Watch 2025 kickoff",
        body:
          "I'm in for another year. Can I take a regional coordinator role for the Santa Fe / Colorado routes? I know it's a larger commitment but I've got the flexibility this year.",
        daysAgo: 48,
        isUnread: false
      },
      {
        kind: "outbound-email",
        actor: "Jordan (you)",
        subject: "Re: Wolverine Watch 2025 kickoff",
        body:
          "Yes — thrilled to have you as regional coord. I'll loop you into the coordinator Slack and put you on the training review list.",
        daysAgo: 47,
        isUnread: false
      },
      {
        kind: "system-event",
        actor: "System",
        body: "Signed up for Wolverine Watch 2025",
        daysAgo: 45,
        isUnread: false
      },
      {
        kind: "system-event",
        actor: "System",
        body: "Completed training for Wolverine Watch 2025",
        daysAgo: 20,
        isUnread: false
      },
      {
        kind: "system-event",
        actor: "System",
        body: "Submitted trip plan for Wolverine Watch 2025",
        daysAgo: 5,
        isUnread: false
      },
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
    volunteerId: "—",
    displayName: "+1 720 555 0199",
    initials: "??",
    avatarTone: "slate",
    volunteerStage: "non-volunteer",
    primaryEmail: null,
    primaryPhone: "+1 720 555 0199",
    cityState: null,
    joinedAtLabel: "First seen Apr 2026",
    activeProjects: [],
    pastProjects: [],
    milestones: [],
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
    case "outbound-auto-email":
    case "outbound-campaign-email":
      return "email";
    case "inbound-sms":
    case "outbound-sms":
    case "outbound-campaign-sms":
      return "sms";
    case "internal-note":
    case "system-event":
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
  if (daysAgo < 60) return `${Math.floor(daysAgo / 7).toString()} weeks ago`;
  if (daysAgo < 365) return `${Math.floor(daysAgo / 30).toString()} months ago`;
  return `${Math.floor(daysAgo / 365).toString()} years ago`;
}

export function getMockContacts(): readonly MockContactRecord[] {
  return CONTACTS;
}

export function getMockContactById(
  contactId: string
): MockContactRecord | null {
  return CONTACTS.find((c) => c.contactId === contactId) ?? null;
}

export type { MockContactRecord, MockMilestone };
