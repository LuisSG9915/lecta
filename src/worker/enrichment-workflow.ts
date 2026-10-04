import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { withClient, type WorkerEnv } from "./db";
import { findEntries, insertEnrichment } from "./lexicon";
import { requestEnrichment } from "./ai";

export type EnrichmentParams = { forms: string[]; language?: string };

const MAX_FORMS_PER_RUN = 50;

export class EnrichmentWorkflow extends WorkflowEntrypoint<WorkerEnv, EnrichmentParams> {
  async run(event: Readonly<WorkflowEvent<EnrichmentParams>>, step: WorkflowStep) {
    const { forms, language = "es" } = event.payload;
    const results: Record<string, string> = {};

    for (const raw of forms.slice(0, MAX_FORMS_PER_RUN)) {
      const form = raw.trim().toLowerCase();
      if (!form) continue;
      results[form] = await step.do(`enrich:${form}`, async () => {
        const existing = await withClient(this.env, (client) =>
          findEntries(client, language, form),
        );
        if (existing?.length) return "existing";

        const ai = await requestEnrichment(this.env, { form, language });
        if (!ai.ok) return ai.reason;

        await withClient(this.env, (client) => insertEnrichment(client, language, ai.enrichment));
        return "created";
      });
    }
    return results;
  }
}
