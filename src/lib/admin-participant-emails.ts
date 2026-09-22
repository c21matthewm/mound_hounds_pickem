import "server-only";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";

const PAGE_SIZE = 200;
const MAX_PAGES = 25;
const EMAIL_WARNING = "Account emails could not be loaded. You can still manage participants; refresh to retry email lookup.";

type ParticipantEmails = {
  emailsByProfileId: Map<string, string>;
  warning: string | null;
};

// Call only after requireAdmin, from an admin page or action. Auth user objects
// and metadata stay on the server; only requested participants' emails leave here.
export async function loadAdminParticipantEmails(profileIds: string[]): Promise<ParticipantEmails> {
  const remaining = new Set(profileIds);
  const emailsByProfileId = new Map<string, string>();
  if (remaining.size === 0) return { emailsByProfileId, warning: null };

  try {
    const supabase = createServiceRoleSupabaseClient();
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
      if (error || !data) throw new Error("Participant email lookup failed.");
      for (const user of data.users) {
        if (!remaining.delete(user.id)) continue;
        if (user.email) emailsByProfileId.set(user.id, user.email);
      }
      if (remaining.size === 0) return { emailsByProfileId, warning: null };
      // Increment our bounded page counter rather than trusting pagination links.
      if (data.users.length < PAGE_SIZE) break;
    }
  } catch {
    // Never log Auth responses or partial email data. The admin sees a retryable
    // warning; a missing service credential must not break the participant editor.
  }
  return { emailsByProfileId: new Map(), warning: EMAIL_WARNING };
}
