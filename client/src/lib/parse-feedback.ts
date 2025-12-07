/**
 * Client-side re-export of shared feedback parser
 * All parsing logic is now in shared/lib/parse-feedback.ts
 */

export {
  parseFeedbackToProposals,
  serializeProposals,
  serializeProposalsToJSON,
  type ChangeProposal
} from '@shared/lib/parse-feedback';
