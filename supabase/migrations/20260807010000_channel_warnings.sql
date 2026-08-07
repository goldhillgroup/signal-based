-- Surface partial vendor failure instead of hiding it.
--
-- Discovery runs three channels under Promise.allSettled, so one going down
-- never stops a run. Good for reliability, quietly bad for trust: a search
-- where Google Maps was budget-capped looked EXACTLY like one where all three
-- channels ran and the state is genuinely mined out. Both show a number and
-- no error. The user then treats a partial answer as the whole picture.
--
-- error_message can't carry this: that column means "the run stopped", and
-- these runs complete successfully. A degraded-but-successful run needs its
-- own field, or the two get conflated and one of them starts lying.
alter table searches add column if not exists warnings text;

comment on column searches.warnings is
  'Human-readable note about channels that were unavailable during an '
  'otherwise successful run (budget cap, missing key, rate limit). NULL = '
  'every channel searched. Built by buildWarningLine() in '
  'lib/pipeline/channel-health.ts. Distinct from error_message, which means '
  'the run itself failed.';
