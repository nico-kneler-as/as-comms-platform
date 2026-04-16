import { EmptyState } from "@/components/ui/empty-state";
import { InboxIcon } from "./claude-icons";

export function ClaudeInboxEmptyState() {
  return (
    <EmptyState
      size="lg"
      icon={<InboxIcon className="h-7 w-7" />}
      title="Select a person to begin"
      description="The Inbox is organized by person. Choose anyone on the left to see their full communication history, context, and reply workflow in one place."
    />
  );
}
