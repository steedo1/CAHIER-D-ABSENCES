import { triggerDispatch, type DispatchTriggerOptions } from "./dispatch-trigger";
export type SmsDispatchOpts = DispatchTriggerOptions;
export function triggerSmsDispatch(opts: SmsDispatchOpts = {}) { return triggerDispatch("sms", opts); }
