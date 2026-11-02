import { triggerDispatch, type DispatchTriggerOptions } from "./dispatch-trigger";
export type Opts = DispatchTriggerOptions;
export function triggerPushDispatch(opts: Opts = {}) { return triggerDispatch("push", opts); }
