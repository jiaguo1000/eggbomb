/**
 * Worker thread entry point for ISMCTS computation.
 * Receives a serialized ISMCTSContext, runs ismctsEvaluate, and posts the result back.
 */
import { workerData, parentPort } from 'worker_threads';
import { ismctsEvaluate, ISMCTSContext } from './ismcts';

type SerializedCtx = Omit<ISMCTSContext, 'playedCardIds'> & { playedCardIds: string[] };

const { ctx: raw, budgetMs } = workerData as { ctx: SerializedCtx; budgetMs: number };

const ctx: ISMCTSContext = {
  ...raw,
  playedCardIds: new Set(raw.playedCardIds),
};

const result = ismctsEvaluate(ctx, budgetMs);
parentPort!.postMessage(result);
