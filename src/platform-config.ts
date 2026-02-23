export interface RoborockHAConfig {
  haUrl: string;
  haToken: string;
  matterMode?: 'bridge' | 'server';
  pollInterval?: number;
  deviceWhitelist?: string[];
  deviceBlacklist?: string[];
  batterySensorMap?: Record<string, string>;
  chargingSensorMap?: Record<string, string>;
  cleaningModeEntityMap?: Record<string, string>;
  errorSensorMap?: Record<string, string>;
  currentRoomSensorMap?: Record<string, string>;
  stateSensorMap?: Record<string, string>;
  taskStatusSensorMap?: Record<string, string>;
  cleanedAreaSensorMap?: Record<string, string>;
  roomAreaSizes?: Record<string, number>;
  cleaningTimeSensorMap?: Record<string, string>;
  hepaFilterSensorMap?: Record<string, string>;
  roomCleaningDuration?: Record<string, number>;
  progressEstimatedTimeCountdown?: boolean;
  phaseList?: string[];
  selectedMapEntityMap?: Record<string, string>;
  mapIdMap?: Record<string, Record<string, number>>;
  countdownTimeSeconds?: number;
  fastMappingButtonMap?: Record<string, string>;
}

/**
 * Validate and normalize the platform configuration object.
 *
 * @param {any} config - Raw configuration object to validate and normalize.
 * @returns {RoborockHAConfig} The validated and normalized configuration.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validateConfig(config: any): RoborockHAConfig {
  if (!config || typeof config !== 'object') {
    throw new Error('Config must be an object');
  }
  if (!config.haUrl) {
    throw new Error('haUrl is required');
  }
  if (!config.haToken) {
    throw new Error('haToken is required');
  }
  // 去掉 haUrl 末尾的 /
  config.haUrl = String(config.haUrl).replace(/\/$/, '');
  // 默认轮询 30 秒
  if (!config.pollInterval || typeof config.pollInterval !== 'number') {
    config.pollInterval = 30000;
  }
  // Apple Home 兼容性最好：server
  if (!config.matterMode) {
    config.matterMode = 'server';
  }
  // 规范化 whitelist / blacklist
  if (config.deviceWhitelist && !Array.isArray(config.deviceWhitelist)) {
    throw new Error('deviceWhitelist must be an array of strings');
  }
  if (config.deviceBlacklist && !Array.isArray(config.deviceBlacklist)) {
    throw new Error('deviceBlacklist must be an array of strings');
  }
  // 验证传感器映射
  if (config.batterySensorMap && typeof config.batterySensorMap !== 'object') {
    throw new Error('batterySensorMap must be an object');
  }
  if (config.chargingSensorMap && typeof config.chargingSensorMap !== 'object') {
    throw new Error('chargingSensorMap must be an object');
  }
  if (config.cleaningModeEntityMap && typeof config.cleaningModeEntityMap !== 'object') {
    throw new Error('cleaningModeEntityMap must be an object');
  }
  if (config.errorSensorMap && typeof config.errorSensorMap !== 'object') {
    throw new Error('errorSensorMap must be an object');
  }
  if (config.currentRoomSensorMap && typeof config.currentRoomSensorMap !== 'object') {
    throw new Error('currentRoomSensorMap must be an object');
  }
  if (config.stateSensorMap && typeof config.stateSensorMap !== 'object') {
    throw new Error('stateSensorMap must be an object');
  }
  if (config.taskStatusSensorMap && typeof config.taskStatusSensorMap !== 'object') {
    throw new Error('taskStatusSensorMap must be an object');
  }
  if (config.cleanedAreaSensorMap && typeof config.cleanedAreaSensorMap !== 'object') {
    throw new Error('cleanedAreaSensorMap must be an object');
  }
  if (config.roomAreaSizes && typeof config.roomAreaSizes !== 'object') {
    throw new Error('roomAreaSizes must be an object');
  }
  if (config.cleaningTimeSensorMap && typeof config.cleaningTimeSensorMap !== 'object') {
    throw new Error('cleaningTimeSensorMap must be an object');
  }
  if (config.hepaFilterSensorMap && typeof config.hepaFilterSensorMap !== 'object') {
    throw new Error('hepaFilterSensorMap must be an object');
  }
  if (config.roomCleaningDuration && typeof config.roomCleaningDuration !== 'object') {
    throw new Error('roomCleaningDuration must be an object');
  }
  if (config.progressEstimatedTimeCountdown !== undefined && typeof config.progressEstimatedTimeCountdown !== 'boolean') {
    throw new Error('progressEstimatedTimeCountdown must be a boolean');
  }
  if (config.phaseList && !Array.isArray(config.phaseList)) {
    throw new Error('phaseList must be an array of strings');
  }
  // 设置默认 phaseList
  if (!config.phaseList || config.phaseList.length === 0) {
    config.phaseList = ['清扫中', '返回充电座', '清洗拖布', '已完成'];
  }
  if (config.selectedMapEntityMap && typeof config.selectedMapEntityMap !== 'object') {
    throw new Error('selectedMapEntityMap must be an object');
  }
  if (config.mapIdMap && typeof config.mapIdMap !== 'object') {
    throw new Error('mapIdMap must be an object');
  }
  if (config.countdownTimeSeconds !== undefined && typeof config.countdownTimeSeconds !== 'number') {
    throw new Error('countdownTimeSeconds must be a number');
  }
  if (config.fastMappingButtonMap && typeof config.fastMappingButtonMap !== 'object') {
    throw new Error('fastMappingButtonMap must be an object');
  }
  return config as RoborockHAConfig;
}
