/* eslint-disable @typescript-eslint/no-explicit-any */
import { RoborockHAPlatform } from './platform.js';

/**
 *
 * @param matterbridge
 * @param log
 * @param config
 */
export default function (matterbridge: any, log: any, config: any) {
  return new RoborockHAPlatform(matterbridge, log, config);
}
